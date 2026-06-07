import importlib.util
import os
import json
from unittest.mock import patch

os.environ['TABLE_NAME'] = 'test-table'
os.environ['REDIS_HOST'] = 'localhost'

# Load redirect handler by explicit path to avoid sys.modules collision with create_url's handler
_handler_path = os.path.join(os.path.dirname(__file__), '..', 'backend', 'lambdas', 'redirect_url', 'handler.py')
_spec = importlib.util.spec_from_file_location('redirect_handler', _handler_path)
handler = importlib.util.module_from_spec(_spec)
with patch('boto3.resource'), patch('redis.Redis'):
    _spec.loader.exec_module(handler)

LONG_URL = 'https://example.com/some/long/path'
ALIAS = 'aB3kZp'


def _event(alias=ALIAS):
    return {'pathParameters': {'alias': alias}}


def test_redis_hit_returns_301_with_hit_header():
    with patch.object(handler, 'redis_client') as mock_redis:
        mock_redis.get.return_value = LONG_URL
        response = handler.handler(_event(), None)
        assert response['statusCode'] == 301
        assert response['headers']['Location'] == LONG_URL
        assert response['headers']['X-Cache'] == 'HIT'
        mock_redis.set.assert_not_called()


def test_redis_miss_dynamo_hit_returns_301_with_miss_header():
    with patch.object(handler, 'redis_client') as mock_redis, \
         patch.object(handler, 'table') as mock_table:
        mock_redis.get.return_value = None
        mock_table.get_item.return_value = {'Item': {'alias': ALIAS, 'long_url': LONG_URL}}
        response = handler.handler(_event(), None)
        assert response['statusCode'] == 301
        assert response['headers']['Location'] == LONG_URL
        assert response['headers']['X-Cache'] == 'MISS'
        mock_redis.set.assert_called_once_with(ALIAS, LONG_URL, ex=handler.REDIS_TTL)


def test_redis_miss_dynamo_miss_returns_404():
    with patch.object(handler, 'redis_client') as mock_redis, \
         patch.object(handler, 'table') as mock_table:
        mock_redis.get.return_value = None
        mock_table.get_item.return_value = {}
        response = handler.handler(_event(), None)
        assert response['statusCode'] == 404


def test_missing_alias_returns_400():
    response = handler.handler({'pathParameters': {}}, None)
    assert response['statusCode'] == 400


def test_redis_exception_returns_500():
    with patch.object(handler, 'redis_client') as mock_redis:
        mock_redis.get.side_effect = Exception('Redis connection error')
        response = handler.handler(_event(), None)
        assert response['statusCode'] == 500
