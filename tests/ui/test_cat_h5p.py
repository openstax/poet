import pytest

from tests.ui.pages.home import HomePoet


@pytest.mark.nondestructive
def test_cat_h5p(chrome_page, github_user, github_password, gitpod_repo_url):
    # GIVEN: Playwright, chromium and a gitpod repo url
    # (https://gitpod.io/#https://github.com/openstax/osbooks-otto-book)

    sign_in_button_selector = "input.btn.btn-primary.btn-block.js-sign-in-button"

    # WHEN: gitpod launches
    chrome_page.goto(gitpod_repo_url)
    home = HomePoet(chrome_page)

    if home.continue_with_github_is_visible:
        home.click_continue_with_github_button()

    with chrome_page.context.pages[1] as github_login_window:
        github_login_window.fill("#login_field", github_user)
        github_login_window.fill("#password", github_password)

        github_login_window.click(sign_in_button_selector)

    if home.continue_with_github_is_visible:
        home.click_continue_with_github_button()

    if home.gitpod_user_dropdown.inner_text() != "0 openstax":
        home.click_gitpod_user_dropdown()
        home.click_gitpod_user_selector()

    if home.continue_with_github_is_visible:
        home.click_continue_with_github_button()

    if home.continue_with_workspace_is_visible:
        home.click_workspace_continue_button()

    # THEN: openstax and cat extension launches and both icons appear
    assert home.openstax_icon_is_visible
    assert home.cat_icon_is_visible

    home.click_openstax_icon()

    # THEN: POET UI launches and is visible
    assert home.open_toc_editor_button_is_visible

    home.click_cat_icon()

    # THEN: CAT UI launches and is visible
    assert home.open_h5p_editor_button_is_visible

    home.click_open_h5p_editor_button()

    assert home.cat_tab_is_visible
    assert home.h5p_editor_create_new_content_button_is_visible

    home.click_openstax_icon()
    home.click_open_toc_editor_button()

    # THEN: Both POET and CAT tabs are visible
    assert home.openstax_tab_is_visible
    assert home.cat_icon_is_visible

    home.click_gitpod_menubar()
    home.click_stop_workspace_button()
