import pytest


@pytest.mark.nondestructive
def test_all_repos_indexes(git_content_repos, headers_data):
    # List indexes of each content repo for cases
    # when only certain book range requires testing
    # with test_content_validation_all_book_repos.py

    for repo in git_content_repos:
        print(f"REPO: {repo} - LIST INDEX: {git_content_repos.index(repo)}")
