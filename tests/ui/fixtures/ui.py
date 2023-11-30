from playwright.sync_api import sync_playwright
import pytest


@pytest.fixture
def chrome_page():
    """Return playwright chromium browser page - slow flow"""
    playwright_sync = sync_playwright().start()
    chrome_browser = playwright_sync.chromium.launch(
        headless=True, slow_mo=1800, timeout=120000
    )
    context = chrome_browser.new_context()

    page = context.new_page()
    yield page

    chrome_browser.close()
    playwright_sync.stop()


@pytest.fixture
def github_user(request):
    """Return a github username"""
    config = request.config
    github_user = config.getoption("github_user") or config.getini("github_user")
    if github_user is not None:
        return github_user


@pytest.fixture
def github_password(request):
    """Return a github password"""
    config = request.config
    github_password = config.getoption("github_password") or config.getini(
        "github_password"
    )
    if github_password is not None:
        return github_password


@pytest.fixture
def gitpod_repo_url(request):
    """Return a git repo url in gitpod"""
    config = request.config
    gitpod_repo_url = config.getoption("gitpod_repo_url") or config.getini(
        "gitpod_repo_url"
    )
    if gitpod_repo_url is not None:
        return gitpod_repo_url


@pytest.fixture
def github_token(request):
    """Return a github token"""
    config = request.config
    github_token = config.getoption("github_token") or config.getini("github_token")
    if github_token is not None:
        return github_token
