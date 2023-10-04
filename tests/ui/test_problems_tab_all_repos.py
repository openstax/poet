import pytest

from tests.ui.pages.home import HomePoet

from bs4 import BeautifulSoup


@pytest.mark.nondestructive
def test_problems_tab_all_repos(
    chrome_page, github_user, github_password, git_content_repos, headers_data
):
    # GIVEN: Playwright, chromium and gitpod
    # repo url as: https://gitpod.io/#https://github.com/openstax/osbooks-otto-book
    # run the test: pytest -k test_problems_tab.py tests/ui --github_user xxx --github_password yyy --github_token zzz

    sign_in_button_selector = "input.btn.btn-primary.btn-block.js-sign-in-button"
    aria_label_0 = 'div[aria-label="Problems (⇧⌘M) - Total 0 Problems"]'

    for repo in git_content_repos:
        gitpod_repo_url = "https://gitpod.io/#https://github.com/openstax/" + repo

        print(f"VERIFYING: {gitpod_repo_url}")

        # WHEN: gitpod launches
        chrome_page.goto(gitpod_repo_url)
        home = HomePoet(chrome_page)

        if not home.github_login_button_is_visible:
            if home.private_repo_warning_is_visible:
                print(f"SKIPPING! Book repo is private: {repo}")
                continue

            else:
                home.click_workspace_continue_button()

                # THEN: openstax extension launches and icon appears
                home.click_openstax_icon()

                # THEN: TOC Editor and book list dropdown is visible
                assert home.open_toc_editor_button_is_visible

                ccont = chrome_page.content()

                sopa = BeautifulSoup(ccont, "html.parser")
                problems = sopa.select(aria_label_0)

                repo_name = gitpod_repo_url.split("openstax/")

                try:
                    assert problems

                except AssertionError:
                    print(f"!!! Problems detected under Problems tab: {repo_name[1]}")
                    continue

                else:
                    print(f"NO PROBLEMS IN {repo_name[1]}")

                home.click_gitpod_menubar()
                home.click_stop_workspace_button()

        else:
            if home.private_repo_warning_is_visible:
                print(f"SKIPPING! Book repo is private: {repo}")
                continue

            else:
                # WHEN: login into repo
                home.click_github_login_button()

                with chrome_page.context.pages[1] as github_login_window:
                    github_login_window.fill("#login_field", github_user)
                    github_login_window.fill("#password", github_password)

                    github_login_window.click(sign_in_button_selector)

                home.click_workspace_continue_button()

                # THEN: openstax extension launches and icon appears
                home.click_openstax_icon()

                # THEN: TOC Editor and book list dropdown is visible
                assert home.open_toc_editor_button_is_visible

                ccont = chrome_page.content()

                sopa = BeautifulSoup(ccont, "html.parser")
                problems = sopa.select(aria_label_0)

                repo_name = gitpod_repo_url.split("openstax/")

                try:
                    assert problems

                except AssertionError:
                    print(f"!!! Problems detected under Problems tab: {repo_name[1]}")
                    continue

                else:
                    print(f"NO PROBLEMS IN {repo_name[1]}")

                home.click_gitpod_menubar()
                home.click_stop_workspace_button()
