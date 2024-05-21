import pytest

import requests

import yaml


@pytest.mark.nondestructive
def test_gitpod_yml_all_book_repos(git_content_repos, headers_data):
    # verifies .gitpod.yml of each repo
    # run the test: pytest -k test_gitpod_yml_all_book_repos.py tests/ui/content --github_token zzz
    # Modified on February 15, 2024

    for repo in git_content_repos:
        gitpod_yml_dir = f"https://api.github.com/repos/openstax/{repo}/contents/"

        print("\nNow verifying: ", repo)

        gitpod_yml_url = f"{gitpod_yml_dir}/.gitpod.yml"

        gitpod_yml_resp = requests.get(gitpod_yml_url, headers=headers_data)

        if gitpod_yml_resp.status_code in range(400, 501):
            print(
                f"Error code {gitpod_yml_resp.status_code}: Incorrect/missing .gitpod.yml file"
            )
            continue

        else:
            gitpod_yml_content = yaml.safe_load(gitpod_yml_resp.text)

            try:
                visibility_by_port = {
                    port["port"]: port["visibility"]
                    for port in gitpod_yml_content["ports"]
                }

                assert visibility_by_port[27149] == "public"

                assert ["openstax.editor", "redhat.vscode-xml"] == gitpod_yml_content[
                    "vscode"
                ]["extensions"]

            except (AssertionError, KeyError, TypeError) as attr:
                print(f"Issue found: {attr}")
