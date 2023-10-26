import pytest

from tests.ui.pages.home import HomePoet


@pytest.mark.nondestructive
def test_content_validation_all_repos(
    chrome_page, github_user, github_password, git_content_repos, headers_data
):
    # GIVEN: Playwright, chromium and gitpod
    # repo url as: https://gitpod.io/#https://github.com/openstax/osbooks-content-repo
    # run the test: pytest -k test_content_validation_all_repos.py tests/ui --github_user xxx --github_password yyy
    # --github_token zzz > validation.log

    sign_in_button_selector = "input.btn.btn-primary.btn-block.js-sign-in-button"

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
                if home.gitpod_user_dropdown.inner_text() == "0 openstax":
                    pass

                else:
                    home.click_gitpod_user_dropdown()
                    home.click_gitpod_user_selector()

                home.click_workspace_continue_button()

                # THEN: openstax extension launches and icon appears
                if not home.openstax_icon_is_visible:
                    print("No openstax icon")
                else:
                    home.click_openstax_icon()

                    # THEN: TOC Editor and book list dropdown is visible
                    if not home.open_toc_editor_button_is_visible:
                        print(">>>TOC Editor button not loaded, skipping")
                        continue

                    else:
                        if home.cannot_activate_poet_dialog_box_is_visible:
                            print(f"POET install issues: {repo}")
                            continue

                        # THEN content validation launches
                        home.click_validate_content_button()
                        home.click_validate_content_all_content_option()

                        home.wait_for_validation_end(
                            lambda: home.validation_notification_dialog_box_is_visible
                        )

                        # THEN Problems tab is checked for any validation problems
                        chrome_page.keyboard.press("Escape")
                        home.click_problems_tab()

                        try:
                            assert (
                                "No problems have been detected in the workspace."
                                in home.problems_tab_message.inner_text()
                            )

                        except AssertionError:
                            print(f"!!! Problems detected under Problems tab: {repo}")
                            print(f"{home.problems_tab_message.inner_text()}")

                        else:
                            print(f"NO PROBLEMS IN {repo}")

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

                if home.gitpod_user_dropdown.inner_text() == "0 openstax":
                    pass

                else:
                    home.click_gitpod_user_dropdown()
                    home.click_gitpod_user_selector()

                home.click_workspace_continue_button()

                if not home.openstax_icon_is_visible:
                    print("No openstax icon")
                else:
                    # THEN: openstax extension launches and icon appears
                    home.click_openstax_icon()

                    # THEN: TOC Editor and book list dropdown is visible
                    if not home.open_toc_editor_button_is_visible:
                        print(">>> TOC Editor button not loaded, skipping")
                        continue

                    else:
                        if home.cannot_activate_poet_dialog_box_is_visible:
                            print(f"POET install issues: {repo}")
                            continue

                        # THEN content validation launches
                        home.click_validate_content_button()
                        home.click_validate_content_all_content_option()

                        home.wait_for_validation_end(
                            lambda: home.validation_notification_dialog_box_is_visible
                        )

                        # THEN Problems tab is checked for any validation problems
                        chrome_page.keyboard.press("Escape")
                        home.click_problems_tab()

                        try:
                            assert (
                                "No problems have been detected in the workspace."
                                in home.problems_tab_message.inner_text()
                            )

                        except AssertionError:
                            print(f"!!! Problems detected under Problems tab: {repo}")
                            print(f"{home.problems_tab_message.inner_text()}")

                        else:
                            print(f"NO PROBLEMS IN {repo}")

                        home.click_gitpod_menubar()
                        home.click_stop_workspace_button()
