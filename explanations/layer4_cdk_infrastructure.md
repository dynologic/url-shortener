# Layer 4 — CDK Infrastructure Stack

## What this layer does and why it exists

This layer defines every AWS resource the system needs — VPC, DynamoDB, ElastiCache, two Lambdas, API Gateway, and CloudWatch alarms — as Python code. Running `cdk deploy` turns that code into real infrastructure in your AWS account. No clicking around in the AWS console required.

---

## What Infrastructure as Code (IaC) is

Normally you would create AWS resources by clicking through the AWS console. IaC means you describe what you want in code instead. The benefits:

- **Repeatable:** run the same code in dev, staging, prod and get identical infrastructure
- **Version-controlled:** your infrastructure lives in git alongside your application code
- **Reviewable:** a teammate can read a PR and see exactly what AWS resources will be created or changed
- **Destroyable:** `cdk destroy` tears everything down cleanly — no orphaned resources

---

## What AWS CDK is

CDK (Cloud Development Kit) lets you write Python (or TypeScript, Java, etc.) that describes AWS resources. CDK then synthesizes that into a CloudFormation template — a JSON/YAML document that AWS uses to actually create the resources.

The flow is:
```
Python CDK code → cdk synth → CloudFormation template → cdk deploy → real AWS resources
```

You never write CloudFormation directly. CDK generates it for you.

---

## What a VPC is

VPC (Virtual Private Cloud) is a private, isolated network inside AWS. Think of it as your own section of the AWS datacenter that nothing outside can reach unless you explicitly allow it.

Every resource we create goes inside this VPC. This matters for ElastiCache — it **cannot** be placed outside a VPC. Lambda also goes inside so it can reach ElastiCache on the private network.

---

## What subnets are

A VPC is divided into subnets — smaller network segments.

- **Public subnet:** has a route to the internet. Things here can be reached from outside AWS (e.g., a load balancer).
- **Private subnet:** no direct internet access. Things here are only reachable from inside the VPC. ElastiCache and Lambda go here.

Lambda in a private subnet still needs to call DynamoDB (which is an AWS-managed service outside the VPC). A **NAT Gateway** in the public subnet handles this: it gives private-subnet resources outbound internet access without exposing them inbound.

---

## What a security group is

A security group is a virtual firewall attached to a resource. It controls which traffic is allowed in (inbound rules) and out (outbound rules).

We create two security groups:
- **Lambda SG:** attached to both Lambda functions
- **Redis SG:** attached to the ElastiCache cluster, with one rule: allow inbound TCP port 6379 from the Lambda SG only

This means only our Lambda functions can talk to Redis. Nothing else — not even other things inside the VPC.

---

## What IAM permissions are

IAM (Identity and Access Management) controls what AWS resources are allowed to do. By default, a Lambda function has no permissions to touch anything.

We explicitly grant:
- `create_url` Lambda: `dynamodb:PutItem` on our table
- `redirect_url` Lambda: `dynamodb:GetItem` on our table

Neither Lambda can delete items, scan the table, or touch any other DynamoDB table. Least privilege — only what is needed.

---

## What `cdk synth` does vs `cdk deploy`

- **`cdk synth`** — generates the CloudFormation template and prints it to the terminal. Nothing is created in AWS. This is our validation step — if it prints a template with no errors, the stack is valid Python and the CDK constructs are wired correctly.
- **`cdk deploy`** — takes the synthesized template and creates/updates all the real AWS resources. This costs money and takes several minutes. We do not run this now.

---

## What `cdk bootstrap` is

Before the first `cdk deploy` in an AWS account/region, you must run `cdk bootstrap` once. This creates an S3 bucket and some IAM roles that CDK uses internally to deploy your stack (it needs somewhere to upload Lambda code, for example). You only ever run it once per account/region.

---

## Resources created by this stack

| Resource | Type | Purpose |
|---|---|---|
| VPC | Network | Private network for Lambda and ElastiCache |
| DynamoDB table | Database | Permanent storage of alias → long_url |
| ElastiCache Redis | Cache | Fast alias lookup, cache-aside pattern |
| Lambda: create_url | Compute | Handles POST /create |
| Lambda: redirect_url | Compute | Handles GET /{alias} |
| API Gateway (HTTP) | Routing | Exposes Lambdas as HTTP endpoints |
| CloudWatch Alarms | Monitoring | Alert on error rate and latency |

---

## Files created

- `infrastructure/app.py`
- `infrastructure/stacks/url_shortener_stack.py`

## Validation

```bash
uv add aws-cdk-lib constructs
uv run cdk synth
```

Expected: CDK prints a CloudFormation template (YAML) to the terminal with no errors. No AWS resources are created.
