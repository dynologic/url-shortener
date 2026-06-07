import os
import sys
import json
from unittest.mock import patch, MagicMock

# Env vars must be set before handler is imported (module-level code reads them)
os.environ['BASE_DOMAIN'] = 'https://short.ly'
os.environ['TABLE_NAME'] = 'test-table'

# Make hashing and handler importable from their local paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend', 'lambdas', 'create_url'))

# Patch boto3 before import so module-level dynamodb/table init does not call AWS
with patch('boto3.resource'):
    import handler


def _event(body: dict) -> dict:
    return {'body': json.dumps(body)}


def test_valid_input_returns_200():
    with patch.object(handler, 'generate_alias', return_value=('abc123', 'Success')), \
         patch.object(handler, 'table') as mock_table:
        response = handler.handler(_event({'long_url': 'https://example.com'}), None)
        assert response['statusCode'] == 200
        body = json.loads(response['body'])
        assert 'short_url' in body
        assert 'abc123' in body['short_url']
        mock_table.put_item.assert_called_once()


def test_missing_long_url_returns_400():
    response = handler.handler(_event({'other': 'value'}), None)
    assert response['statusCode'] == 400


def test_generate_alias_error_returns_400():
    with patch.object(handler, 'generate_alias', return_value=('', 'Invalid Input Data')):
        response = handler.handler(_event({'long_url': 'not-a-url'}), None)
        assert response['statusCode'] == 400
        assert json.loads(response['body'])['message'] == 'Invalid Input Data'


def test_dynamodb_exception_returns_500():
    with patch.object(handler, 'generate_alias', return_value=('abc123', 'Success')), \
         patch.object(handler, 'table') as mock_table:
        mock_table.put_item.side_effect = Exception('DynamoDB error')
        response = handler.handler(_event({'long_url': 'https://example.com'}), None)
        assert response['statusCode'] == 500
