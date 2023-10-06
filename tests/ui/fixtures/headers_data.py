import pytest


@pytest.fixture
def headers_data(github_token):
    """Returns the headers with token"""
    headers = {
        "Authorization": "token " + github_token,
        "Accept": "application/vnd.github.v3.raw",
    }

    return headers
