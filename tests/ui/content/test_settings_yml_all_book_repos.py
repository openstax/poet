import pytest

import requests

import yaml


@pytest.mark.nondestructive
def test_settings_yml_all_book_repos(git_content_repos, headers_data):
    # verifies settings.yml in .github folder of each repo
    # run the test: pytest -k test_settings_private_all_book_repos.py tests/ui/content --github_token zzz
    # Modified on January 26, 2024

    for repo in git_content_repos:
        github_settings_yml_dir = (
            f"https://api.github.com/repos/openstax/{repo}/contents/.github/"
        )

        print("\nNow verifying: ", repo)

        settings_yml_list = requests.get(github_settings_yml_dir, headers=headers_data)

        if settings_yml_list.status_code != 200:
            print(
                f">>>>> FAILED {settings_yml_list.status_code}: no .github folder in {repo}"
            )

        else:
            for item in settings_yml_list.json():
                if item["type"] != "file":
                    print("Found also a directory...?")
                    continue

                settings_yml_url = f"{github_settings_yml_dir}settings.yml"

                settings_yml_resp = requests.get(settings_yml_url, headers=headers_data)

                if settings_yml_resp.status_code in range(400, 501):
                    print(
                        f"Error code {settings_yml_resp.status_code}: Incorrect/missing settings.yml file"
                    )
                    continue

                else:
                    settings_yml_content = yaml.safe_load(settings_yml_resp.text)

                    try:
                        settings_yml_list = list(settings_yml_content.values())[0]

                    except AttributeError:
                        print("key:value missing in .github/settings.yml")

                    else:
                        try:
                            is_private = settings_yml_content["repository"]["private"]

                            if is_private:
                                print(
                                    f"<<< repository:private entry in .github/settings.yml is set to {is_private}"
                                )
                                continue

                        except (KeyError, TypeError):
                            print("!!! issue with private key in .github/settings.yml")
