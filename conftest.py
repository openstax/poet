import os

import pytest

# Import fixtures
pytest_plugins = (
    "tests.ui.fixtures.ui",
    "tests.ui.fixtures.git_content_repos",
    "tests.ui.fixtures.headers_data",
)


def get_custom_markers():
    """Function used to register custom markers.

    Define custom markers within this function to register them in pytest
    """
    return (
        "integration: mark tests that are integration tests",
        "smoke: mark tests used for smoke testing",
        "testrail: mark tests used for testrail runs",
        "ui: mark tests used for ui tests",
        "unit: mark tests as a unit test",
        "nondestructive: tests using this decorator will run in sensitive environments",
        "sensitive: the url for environments where destructive tests should not be executed",
    )


# Due to no longer using pytest-selenium because it is unmaintained (and we moved to playwright)
# we migrated the nondestructive and sensitive url config options.
# https://github.com/pytest-dev/pytest-selenium/blob/c0c1e54c68e02727a3d0b2755cc90cd162af99af/mozwebqa/mozwebqa.py
def pytest_addoption(parser):
    group = parser.getgroup("safety", "safety")
    group.addoption(
        "--destructive",
        action="store_true",
        dest="run_destructive",
        default=False,
        help="include destructive tests (tests not explicitly marked as 'nondestructive'). (disabled by default).",
    )
    parser.addini("github_user", help="github user")
    parser.addoption(
        "--github_user",
        metavar="tag",
        default=os.getenv("GITHUB_USER", None),
        help="github user",
    )
    parser.addini("github_password", help="github password")
    parser.addoption(
        "--github_password",
        metavar="tag",
        default=os.getenv("GITHUB_PASSWORD", None),
        help="github password",
    )
    parser.addini("gitpod_repo_url", help="gitpod repo url")
    parser.addoption(
        "--gitpod_repo_url",
        metavar="tag",
        default=os.getenv("GITPOD_REPO_URL", None),
        help="gitpod_repo_url",
    )
    parser.addini("github_token", help="github token")
    parser.addoption(
        "--github_token",
        metavar="tag",
        default=os.getenv("GITHUB_TOKEN", None),
        help="github_token",
    )


def pytest_configure(config):
    for marker in get_custom_markers():
        config.addinivalue_line("markers", marker)

    if not config.option.run_destructive:
        if config.option.markexpr:
            config.option.markexpr = f"nondestructive and {config.option.markexpr}"


def pytest_runtest_setup(item):
    destructive = "nondestructive" not in item.keywords

    if destructive:
        # Skip the test with an appropriate message
        pytest.skip(
            "This test is destructive and the target URL is"
            "considered a sensitive environment. If this test"
            "is not destructive add the 'nondestructive' marker."
        )
