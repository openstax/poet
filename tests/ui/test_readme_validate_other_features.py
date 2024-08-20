import pytest

from tests.ui.pages.home import HomePoet


@pytest.mark.nondestructive
def test_readme_validate_other_features(
    chrome_page, github_user, github_password, gitpod_repo_url
):
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

    # THEN: openstax extension launches and icon appears
    assert home.openstax_icon_is_visible

    # THEN: POET UI launches and is visible
    home.click_cat_icon()
    home.click_openstax_icon()

    home.click_push_content_button()

    assert home.push_message_input_field_is_visible
    assert "Push Content: Pushing..." in home.push_content_dialog_box.inner_text()

    chrome_page.keyboard.press("Escape")
    assert home.push_message_input_field_not_visible

    home.click_generate_readme_button()
    assert home.generate_readme_dialog_box_is_visible

    home.click_validate_content_button()
    assert home.validate_content_popup_dialog_is_visible

    home.click_validate_content_cancel_button()
    assert not home.validate_content_popup_dialog_is_visible

    home.click_gitpod_menubar()
    home.click_stop_workspace_button()
