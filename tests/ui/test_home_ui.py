import pytest

from tests.ui.pages.home import HomePoet


@pytest.mark.nondestructive
def test_home_ui(chrome_page, github_user, github_password, gitpod_repo_url):
    # GIVEN: Playwright, chromium and a gitpod repo url
    # (https://gitpod.io/#https://github.com/openstax/osbooks-otto-book)

    # WHEN: gitpod launches
    chrome_page.goto(gitpod_repo_url)
    home = HomePoet(chrome_page)

    home.click_github_login_button()

    with chrome_page.context.pages[1] as github_login_window:
        github_login_window.fill("#login_field", github_user)
        github_login_window.fill("#password", github_password)

        github_login_window.click("input.btn.btn-primary.btn-block.js-sign-in-button")

    if home.gitpod_user_dropdown.inner_text() == "0 openstax":
        pass

    else:
        home.click_gitpod_user_dropdown()
        home.click_gitpod_user_selector()

    home.click_workspace_continue_button()

    # THEN: openstax extension launches and icon appears
    assert home.openstax_icon_is_visible

    home.click_openstax_icon()

    # THEN: POET UI launches and is visible
    assert home.open_toc_editor_button_is_visible
    assert home.push_content_button_is_visible
    assert home.generate_readme_button_is_visible
    assert home.validate_content_button_is_visible

    assert home.toc_tree_dropdown_list_is_visible
    assert "TOC TREES" in home.toc_tree_dropdown_list_is_visible.inner_text()

    home.click_open_toc_editor_button()

    assert home.toc_editor_add_buttons_are_visible
    assert home.chapter_subcollection_list_is_visible

    assert home.toc_editor_all_modules_dropdown_is_visible
    assert home.toc_editor_deleted_modules_list_is_visible

    home.click_gitpod_menubar()
    home.click_stop_workspace_button()
