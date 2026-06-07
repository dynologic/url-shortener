import os
import sys
import aws_cdk as cdk

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stacks.url_shortener_stack import UrlShortenerStack

app = cdk.App()
UrlShortenerStack(
    app, "UrlShortenerStack",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
    ),
)
app.synth()
