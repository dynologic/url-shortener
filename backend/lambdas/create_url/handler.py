import boto3
import os
import json
import time
import sys
from dotenv import load_dotenv

sys.path.append('/var/task/shared')
from hashing import generate_alias

load_dotenv()
BASE_DOMAIN = os.environ['BASE_DOMAIN']
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body)
    }


def handler(event, context):
    try:
        body = json.loads(event['body'])
        long_url = body.get('long_url')
        if long_url is None:
            return _response(400, {"message": "Missing long_url"})

        epoch_time = int(time.time())
        alias, message = generate_alias(long_url, epoch_time)
        if message != "Success":
            return _response(400, {"message": message})

        table.put_item(Item={
            'alias': alias,
            'long_url': long_url,
            'created_at': epoch_time
        })

        return _response(200, {
            "short_url": f"{BASE_DOMAIN}/{alias}",
            "message": "Success"
        })
    except Exception as e:
        return _response(500, {"message": str(e)})
