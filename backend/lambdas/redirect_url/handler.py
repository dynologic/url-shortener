import boto3
import os
import json
import redis
from dotenv import load_dotenv

load_dotenv()
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
redis_client = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=int(os.environ.get('REDIS_PORT', 6379)),
    decode_responses=True
)
REDIS_TTL = int(os.environ.get('REDIS_TTL', 3600))


def _redirect(long_url: str, cache_status: str) -> dict:
    return {
        "statusCode": 301,
        "headers": {
            "Location": long_url,
            "X-Cache": cache_status,
            "Access-Control-Allow-Origin": "*"
        },
        "body": ""
    }


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body)
    }


def handler(event, context):
    try:
        alias = event.get('pathParameters', {}).get('alias')
        if not alias:
            return _response(400, {"message": "Missing alias"})

        method = event.get('requestContext', {}).get('http', {}).get('method', 'GET').upper()

        if method == 'DELETE':
            redis_client.delete(alias)
            return _response(200, {"message": f"Cache cleared for {alias}"})

        long_url = redis_client.get(alias)
        if long_url:
            return _redirect(long_url, "HIT")

        item = table.get_item(Key={'alias': alias}).get('Item')
        if not item:
            return _response(404, {"message": "Alias not found"})

        redis_client.set(alias, item['long_url'], ex=REDIS_TTL)
        return _redirect(item['long_url'], "MISS")
    except Exception as e:
        return _response(500, {"message": str(e)})
