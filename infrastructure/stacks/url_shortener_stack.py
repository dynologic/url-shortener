import base64
import os
import sys
import shutil
import subprocess
import jsii
from constructs import Construct
from aws_cdk import (
    Stack,
    RemovalPolicy,
    Duration,
    CfnOutput,
    ILocalBundling,
    BundlingOptions,
    DockerImage,
    aws_ec2 as ec2,
    aws_dynamodb as dynamodb,
    aws_elasticache as elasticache,
    aws_lambda as lambda_,
    aws_cloudwatch as cloudwatch,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as integrations,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3_deployment as s3deploy,
)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@jsii.implements(ILocalBundling)
class _LocalBundler:
    """Copy a Lambda handler dir + shared module into the CDK asset output directory."""

    def __init__(self, lambda_subdir: str, packages: list) -> None:
        self._lambda_dir = os.path.join(_PROJECT_ROOT, "backend", "lambdas", lambda_subdir)
        self._shared_dir = os.path.join(_PROJECT_ROOT, "backend", "shared")
        self._packages = packages

    def try_bundle(self, output_dir: str, _options: BundlingOptions) -> bool:
        # Install dependencies into output dir so they are included in the Lambda zip
        if self._packages:
            subprocess.check_call([
                "uv", "pip", "install",
                "--python", sys.executable,
                "--target", output_dir,
                *self._packages,
                "--quiet",
            ])
        # Copy handler file(s)
        for item in os.listdir(self._lambda_dir):
            src = os.path.join(self._lambda_dir, item)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(output_dir, item))
        # Copy shared/ subdirectory
        dest_shared = os.path.join(output_dir, "shared")
        if os.path.exists(dest_shared):
            shutil.rmtree(dest_shared)
        shutil.copytree(self._shared_dir, dest_shared)
        return True


@jsii.implements(ILocalBundling)
class _FrontendBundler:
    """Build the React frontend and copy dist/ into the CDK asset output directory."""

    def __init__(self, api_url: str, default_alias: str = '') -> None:
        self._frontend_dir = os.path.join(_PROJECT_ROOT, "frontend")
        self._api_url = api_url
        self._default_alias = default_alias

    def try_bundle(self, output_dir: str, _options: BundlingOptions) -> bool:
        import json
        env = os.environ.copy()
        env["VITE_API_URL"] = self._api_url
        subprocess.check_call(["npm", "run", "build"], cwd=self._frontend_dir, env=env)
        dist_dir = os.path.join(self._frontend_dir, "dist")
        for item in os.listdir(dist_dir):
            src = os.path.join(dist_dir, item)
            dst = os.path.join(output_dir, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
        # Write runtime config — injected into S3, never baked into the JS bundle
        with open(os.path.join(output_dir, "config.json"), "w") as f:
            json.dump({"apiUrl": self._api_url, "defaultAlias": self._default_alias}, f)
        return True


class UrlShortenerStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # BASE_DOMAIN is not known until after first deploy — pass via cdk context:
        # cdk deploy -c base_domain=https://xxx.execute-api.us-east-1.amazonaws.com
        base_domain = self.node.try_get_context("base_domain") or "REPLACE_WITH_API_URL_AFTER_DEPLOY"
        default_alias = self.node.try_get_context("default_alias") or ""

        # --- Networking ---
        vpc = ec2.Vpc(
            self, "Vpc",
            max_azs=2,
            nat_gateways=1,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="Public", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24
                ),
                ec2.SubnetConfiguration(
                    name="Private", subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS, cidr_mask=24
                ),
            ],
        )

        lambda_sg = ec2.SecurityGroup(
            self, "LambdaSG", vpc=vpc, description="Lambda functions", allow_all_outbound=True
        )
        redis_sg = ec2.SecurityGroup(
            self, "RedisSG", vpc=vpc, description="ElastiCache Redis", allow_all_outbound=False
        )
        redis_sg.add_ingress_rule(
            peer=lambda_sg,
            connection=ec2.Port.tcp(6379),
            description="Allow Lambda to connect to Redis",
        )

        # --- DynamoDB ---
        table = dynamodb.Table(
            self, "UrlTable",
            partition_key=dynamodb.Attribute(name="alias", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # --- ElastiCache Redis (single node) ---
        redis_subnet_group = elasticache.CfnSubnetGroup(
            self, "RedisSubnetGroup",
            description="Subnet group for Redis",
            subnet_ids=[s.subnet_id for s in vpc.private_subnets],
        )
        redis_cluster = elasticache.CfnCacheCluster(
            self, "RedisCluster",
            cache_node_type="cache.t3.micro",
            engine="redis",
            engine_version="7.0",
            num_cache_nodes=1,
            cache_subnet_group_name=redis_subnet_group.ref,
            vpc_security_group_ids=[redis_sg.security_group_id],
        )

        # --- Lambda helpers ---
        def _code(lambda_subdir: str, packages: list) -> lambda_.Code:
            pip_cmd = " ".join(["pip install"] + packages + ["-t /asset-output/ --quiet &&"]) if packages else ""
            return lambda_.Code.from_asset(
                os.path.join(_PROJECT_ROOT, "backend"),
                bundling=BundlingOptions(
                    image=lambda_.Runtime.PYTHON_3_11.bundling_image,
                    command=[
                        "bash", "-c",
                        f"{pip_cmd} cp lambdas/{lambda_subdir}/handler.py /asset-output/ "
                        "&& mkdir -p /asset-output/shared "
                        "&& cp shared/*.py /asset-output/shared/",
                    ],
                    local=_LocalBundler(lambda_subdir, packages),
                ),
            )

        vpc_placement = ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS)

        # --- create_url Lambda ---
        create_url_fn = lambda_.Function(
            self, "CreateUrlFn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=_code("create_url", ["python-dotenv", "pybase62"]),
            memory_size=256,
            timeout=Duration.seconds(10),
            vpc=vpc,
            vpc_subnets=vpc_placement,
            security_groups=[lambda_sg],
            environment={
                "TABLE_NAME": table.table_name,
                "BASE_DOMAIN": base_domain,
                "ALIAS_LENGTH": "6",
            },
        )
        table.grant(create_url_fn, "dynamodb:PutItem")

        # --- redirect_url Lambda ---
        redirect_url_fn = lambda_.Function(
            self, "RedirectUrlFn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=_code("redirect_url", ["python-dotenv", "redis"]),
            memory_size=256,
            timeout=Duration.seconds(5),
            vpc=vpc,
            vpc_subnets=vpc_placement,
            security_groups=[lambda_sg],
            environment={
                "TABLE_NAME": table.table_name,
                "REDIS_HOST": redis_cluster.attr_redis_endpoint_address,
                "REDIS_PORT": "6379",
                "REDIS_TTL": "3600",
            },
        )
        table.grant(redirect_url_fn, "dynamodb:GetItem")

        # --- API Gateway (HTTP API) ---
        http_api = apigwv2.HttpApi(
            self, "HttpApi",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.ANY],
                allow_headers=["*"],
            ),
        )
        http_api.add_routes(
            path="/create",
            methods=[apigwv2.HttpMethod.POST],
            integration=integrations.HttpLambdaIntegration("CreateIntegration", create_url_fn),
        )
        http_api.add_routes(
            path="/{alias}",
            methods=[apigwv2.HttpMethod.GET],
            integration=integrations.HttpLambdaIntegration("RedirectIntegration", redirect_url_fn),
        )
        http_api.add_routes(
            path="/{alias}",
            methods=[apigwv2.HttpMethod.DELETE],
            integration=integrations.HttpLambdaIntegration("ClearCacheIntegration", redirect_url_fn),
        )

        # --- CloudWatch Alarms ---
        for fn, name in [(create_url_fn, "CreateUrl"), (redirect_url_fn, "RedirectUrl")]:
            cloudwatch.Alarm(
                self, f"{name}ErrorRateAlarm",
                metric=cloudwatch.MathExpression(
                    expression="(errors / MAX([errors, invocations])) * 100",
                    using_metrics={
                        "errors": fn.metric_errors(period=Duration.minutes(5)),
                        "invocations": fn.metric_invocations(period=Duration.minutes(5)),
                    },
                    period=Duration.minutes(5),
                ),
                threshold=5,
                evaluation_periods=1,
                comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
                alarm_description=f"{name} error rate > 5% over 5 minutes",
            )

        cloudwatch.Alarm(
            self, "RedirectP99Alarm",
            metric=redirect_url_fn.metric_duration(
                period=Duration.minutes(5),
                statistic="p99",
            ),
            threshold=500,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            alarm_description="redirect_url p99 latency > 500ms",
        )

        # --- Frontend: S3 + CloudFront + Basic Auth ---
        # Password passed via CDK context: cdk deploy -c frontend_password=<password>
        frontend_user = self.node.try_get_context("frontend_user") or "owen"
        frontend_password = self.node.try_get_context("frontend_password")
        if not frontend_password:
            raise ValueError("frontend_password context variable is required. Pass: -c frontend_password=<password>")
        credentials_b64 = base64.b64encode(f"{frontend_user}:{frontend_password}".encode()).decode()
        auth_js = f"""
function handler(event) {{
    var headers = event.request.headers;
    if (!headers.authorization || headers.authorization.value !== "Basic {credentials_b64}") {{
        return {{
            statusCode: 401,
            statusDescription: "Unauthorized",
            headers: {{ "www-authenticate": {{ value: 'Basic realm="URL Shortener"' }} }}
        }};
    }}
    return event.request;
}}
"""
        auth_fn = cloudfront.Function(
            self, "BasicAuthFn",
            code=cloudfront.FunctionCode.from_inline(auth_js),
            runtime=cloudfront.FunctionRuntime.JS_2_0,
        )

        frontend_bucket = s3.Bucket(
            self, "FrontendBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        distribution = cloudfront.Distribution(
            self, "FrontendDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(frontend_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                function_associations=[cloudfront.FunctionAssociation(
                    function=auth_fn,
                    event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                )],
            ),
            default_root_object="index.html",
            error_responses=[
                cloudfront.ErrorResponse(http_status=403, response_http_status=200, response_page_path="/index.html"),
                cloudfront.ErrorResponse(http_status=404, response_http_status=200, response_page_path="/index.html"),
            ],
        )

        s3deploy.BucketDeployment(
            self, "FrontendDeployment",
            sources=[s3deploy.Source.asset(
                os.path.join(_PROJECT_ROOT, "frontend"),
                bundling=BundlingOptions(
                    image=DockerImage.from_registry("node:18"),
                    command=["bash", "-c",
                        f"npm install && VITE_API_URL={base_domain} npm run build && cp -r dist/* /asset-output/"],
                    local=_FrontendBundler(base_domain, default_alias),
                ),
            )],
            destination_bucket=frontend_bucket,
            distribution=distribution,
            distribution_paths=["/*"],
        )

        # --- Stack outputs ---
        CfnOutput(
            self, "ApiUrl",
            value=http_api.url,
            description="API Gateway URL",
        )
        CfnOutput(self, "TableName", value=table.table_name, description="DynamoDB table name")
        CfnOutput(
            self, "FrontendUrl",
            value=f"https://{distribution.distribution_domain_name}",
            description="Frontend URL (Basic Auth protected)",
        )
