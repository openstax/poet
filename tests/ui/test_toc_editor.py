import pytest

from tests.ui.pages.home import HomePoet


@pytest.mark.nondestructive
def test_toc_editor(chrome_page, github_user, github_password, gitpod_repo_url):
    # GIVEN: Playwright, chromium and a gitpod repo url
    # (https://gitpod.io/#https://github.com/openstax/osbooks-otto-book)

    sign_in_button_selector = "input.btn.btn-primary.btn-block.js-sign-in-button"

    # WHEN: gitpod launches
    chrome_page.goto(gitpod_repo_url)
    home = HomePoet(chrome_page)

    # WHEN: login into openstax/osbooks-otto-book repo
    if home.continue_with_github_is_visible:
        home.click_continue_with_github_button()

    with chrome_page.context.pages[1] as github_login_window:
        github_login_window.fill("#login_field", github_user)
        github_login_window.fill("#password", github_password)

        github_login_window.click(sign_in_button_selector)

    if home.gitpod_user_dropdown.inner_text() != "0 openstax":
        home.click_gitpod_user_dropdown()
        home.click_gitpod_user_selector()

    home.click_workspace_continue_button()

    # THEN: openstax extension launches and icon appears
    assert home.openstax_icon_is_visible

    home.click_openstax_icon()

    # THEN: TOC Editor and book list dropdown is visible
    assert home.open_toc_editor_button_is_visible

    home.click_open_toc_editor_button()

    home.click_book_list_dropdown()

    assert "Tőkés tűíz" in home.book_list_dropdown_locator.inner_text()

    chrome_page.keyboard.press("Escape")

    home.click_add_module()

    # THEN: Add module input box is visible and editable
    assert home.add_module_input_box_is_visible

    assert (
        "Title of new Page (Press 'Enter' to confirm or 'Escape' to cancel)"
        in home.add_module_input_box_is_visible.inner_text()
    )

    home.fill_add_module_input_box("qachapter")

    chrome_page.keyboard.press("Enter")

    assert "qachapter" in home.chapter_subcollection_list_is_visible.inner_text()

    # THEN: Chapter box title is editable
    home.click_chapter_box_title()

    home.fill_chapter_box_title("qa-renamed")

    chrome_page.keyboard.press("Enter")

    assert "qa-renamed" in home.chapter_subcollection_list_is_visible.inner_text()

    # THEN: Add subcollection box is visible and editable
    home.click_add_subcollection()

    assert home.add_subcollection_input_box_is_visible

    assert (
        "Title of new Book Section (Press 'Enter' to confirm or 'Escape' to cancel)"
        in home.add_subcollection_input_box_is_visible.inner_text()
    )

    home.fill_add_subcollection_input_box("QADIR")

    chrome_page.keyboard.press("Enter")

    assert "QADIR" in home.chapter_subcollection_list_is_visible.inner_text()

    home.click_new_subcollection_box_title()

    home.fill_new_subcollection_box_title("NEW-QA-DIR")

    chrome_page.keyboard.press("Enter")

    assert "NEW-QA-DIR" in home.chapter_subcollection_list_is_visible.inner_text()

    # THEN: search field is visible and editable
    home.fill_search_field("Eger")

    assert home.search_item_amount_indicator_is_visible

    home.click_gitpod_menubar()
    home.click_stop_workspace_button()
