class HomePoet:
    def __init__(self, page):
        self.page = page

    @property
    def github_login_button_locator(self):
        return self.page.locator(".btn-login")

    def click_github_login_button(self):
        self.github_login_button_locator.click()

    @property
    def login_button_locator(self):
        return self.page.locator(
            "div > input.btn.btn-primary.btn-block.js-sign-in-button"
        )

    def click_login_button(self):
        self.login_button_locator.click()

    @property
    def openstax_icon(self):
        return self.page.wait_for_selector(
            "div > div.composite-bar > div > ul > li:nth-child(7)", timeout=99000
        )

    @property
    def openstax_icon_is_visible(self):
        return self.page.is_visible(
            "div > div.composite-bar > div > ul > li:nth-child(7)"
        )

    def click_openstax_icon(self):
        self.openstax_icon.click()

    @property
    def parent_frame(self):
        return self.page.frame_locator("iframe").last

    @property
    def child_frame(self):
        return self.parent_frame.frame_locator("#active-frame")

    @property
    def open_toc_editor_button_is_visible(self):
        return self.page.is_visible("div > div.welcome-view-content > div:nth-child(1)")

    @property
    def open_toc_editor_button_locator(self):
        return self.page.locator("div > div.welcome-view-content > div:nth-child(1)")

    def click_open_toc_editor_button(self):
        return self.open_toc_editor_button_locator.click()

    @property
    def push_content_button_is_visible(self):
        return self.page.is_visible("div > div.welcome-view-content > div:nth-child(2)")

    @property
    def validate_content_button_is_visible(self):
        return self.page.is_visible("div > div.welcome-view-content > div:nth-child(4)")

    @property
    def toc_tree_dropdown_list_is_visible(self):
        return self.page.locator(
            "div.split-view-container > div:nth-child(2) > div > div.pane-header.expanded > h3"
        )

    # TOC Editor left panel ------

    @property
    def toc_editor_add_buttons_are_visible(self):
        # Books dropdown, Add Module and Add Subcollection buttons
        return self.page.locator("div.panel-editable > div.controls > div:nth-child(2)")

    @property
    def book_list_dropdown_locator(self):
        return self.child_frame.locator(
            "div > div.panel-editable > div.controls > select"
        )

    def click_book_list_dropdown(self):
        self.book_list_dropdown_locator.click()

    @property
    def add_module_locator(self):
        return self.child_frame.locator("button.page-create")

    def click_add_module(self):
        self.add_module_locator.click()

    @property
    def add_module_input_box_is_visible(self):
        return self.page.locator("div.quick-input-widget.show-file-icons")

    @property
    def add_module_input_box_locator(self):
        return self.page.locator(
            'div.quick-input-widget.show-file-icons input[type="text"]'
        )

    def fill_add_module_input_box(self, value):
        self.add_module_input_box_locator.fill(value)

    @property
    def chapter_box_title_locator(self):
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > div > div > div:nth-child(1) > div.rst__nodeContent > div > div > div > div.rst__rowContents > div.rst__rowLabel > span.rst__rowTitle.rst__rowTitleWithSubtitle"
        )

    @property
    def chapter_box_title_input(self):
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > div > div > div:nth-child(1) > div.rst__nodeContent > div > div > div > div.rst__rowContents > div.rst__rowLabel > span.rst__rowTitle.rst__rowTitleWithSubtitle > input"
        )

    def click_chapter_box_title(self):
        self.chapter_box_title_locator.click()

    def fill_chapter_box_title(self, value):
        self.chapter_box_title_input.fill(value)

    @property
    def add_subcollection_locator(self):
        return self.child_frame.locator("button.subbook-create")

    def click_add_subcollection(self):
        self.add_subcollection_locator.click()

    @property
    def add_subcollection_input_box_locator(self):
        return self.page.locator(
            'div.quick-input-widget.show-file-icons input[type="text"]'
        )

    @property
    def add_subcollection_input_box_is_visible(self):
        return self.page.locator("div.quick-input-widget.show-file-icons")

    def fill_add_subcollection_input_box(self, value):
        self.add_subcollection_input_box_locator.fill(value)

    @property
    def chapter_subcollection_list_is_visible(self):
        # List of chapter and subcollection boxes (left panel)
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1)"
        )

    @property
    def subcollection_locator_new_box(self):
        # Last newly added item in the chapter list (left panel)
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > div > div > div:nth-child(1)"
        )

    @property
    def subcollection_locator_new_box_title(self):
        # Title of the last newly added item in the chapter list (left panel)
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > div > div > div:nth-child(1) > div.rst__nodeContent > div > div > div > div.rst__rowContents > div.rst__rowLabel"
        )

    @property
    def subcollection_locator_new_box_title_input(self):
        # Title of the last newly added item in the chapter list (left panel)
        return self.child_frame.locator(
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > div > div > div:nth-child(1) > div.rst__nodeContent > div > div > div > div.rst__rowContents > div.rst__rowLabel > span > input"
        )

    def click_new_subcollection_box_title(self):
        self.subcollection_locator_new_box_title.click()

    def fill_new_subcollection_box_title(self, value):
        self.subcollection_locator_new_box_title_input.fill(value)

    @property
    def search_field_locator(self):
        return self.child_frame.locator(
            "div > div.panel-editable > div.controls > div:nth-child(3) > input"
        )

    def fill_search_field(self, value):
        self.search_field_locator.fill(value)

    @property
    def search_item_amount_indicator_is_visible(self):
        # Search info (how many items search shows)
        return self.child_frame.locator(
            "div.panel-editable > div.controls > div:nth-child(3) > p"
        )

    # TOC Editor right panel ------

    @property
    def toc_editor_all_modules_dropdown_is_visible(self):
        return self.page.locator("div.panel-uneditable > div.controls")

    @property
    def toc_editor_deleted_modules_list_is_visible(self):
        return self.page.locator(
            "div.panel-uneditable > div:nth-child(2) > div > div > div > div:nth-child(1)"
        )

    # To stop workspace ----

    @property
    def gitpod_menubar_locator(self):
        return self.page.locator('div[class="menubar-menu-button"]')

    def click_gitpod_menubar(self):
        self.gitpod_menubar_locator.click()

    @property
    def stop_workspace_button_locator(self):
        return self.page.locator(
            "div.menubar-menu-items-holder.monaco-menu-container > div > div.monaco-menu > div > ul > li:nth-child(15) > a > span.action-label"
        )

    def click_stop_workspace_button(self):
        self.stop_workspace_button_locator.click()
