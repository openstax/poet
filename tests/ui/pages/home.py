import time


class HomePoet:
    def __init__(self, page):
        self.page = page

    @property
    def workspace_continue_button(self):
        return self.page.locator("button").get_by_text("Continue")

    def click_workspace_continue_button(self):
        self.workspace_continue_button.click()

    @property
    def openstax_icon_is_visible(self):
        return self.page.wait_for_selector("ul > li:nth-child(7)", timeout=90000)

    def click_openstax_icon(self):
        self.openstax_icon_is_visible.click()

    @property
    def parent_frame(self):
        return self.page.frame_locator("iframe").last

    @property
    def child_frame(self):
        return self.parent_frame.frame_locator("#active-frame")

    @property
    def open_toc_editor_button_is_visible(self):
        return self.page.get_by_text("Open ToC Editor", exact=True)

    def click_open_toc_editor_button(self):
        return self.open_toc_editor_button_is_visible.click()

    @property
    def push_content_button_is_visible(self):
        return self.page.get_by_text("Push Content", exact=True)

    def click_push_content_button(self):
        return self.push_content_button_is_visible.click()

    @property
    def push_message_input_field_is_visible(self):
        return self.page.locator("div.monaco-inputbox.idle.synthetic-focus")

    @property
    def push_message_input_field_not_visible(self):
        return self.page.locator("div.monaco-inputbox.idle")

    @property
    def push_content_dialog_box(self):
        return self.page.locator("div > div.notifications-toasts.visible")

    @property
    def push_content_dialog_box_cancel_button(self):
        return self.page.locator("div.notification-list-item-buttons-container")

    def click_push_content_dialog_box_cancel_button(self):
        return self.push_content_dialog_box_cancel_button.click()

    @property
    def generate_readme_button_is_visible(self):
        return self.page.get_by_text("Generate README", exact=True)

    def click_generate_readme_button(self):
        return self.generate_readme_button_is_visible.click()

    @property
    def generate_readme_dialog_box_is_visible(self):
        return self.page.wait_for_selector("div.notifications-toasts.visible")

    @property
    def generate_readme_dialog_box_text(self):
        return self.page.locator(
            "div.notification-list-item-main-row > div.notification-list-item-message"
        )

    @property
    def validate_content_button_is_visible(self):
        return self.page.get_by_text("Validate Content", exact=True)

    @property
    def validate_content_popup_dialog_is_visible(self):
        return self.page.is_visible("div > div.monaco-dialog-modal-block.dimmed")

    @property
    def toc_tree_dropdown_list_is_visible(self):
        return self.page.locator(
            "div.split-view-container > div:nth-child(2) > div > div.pane-header.expanded"
        )

    def click_validate_content_button(self):
        return self.validate_content_button_is_visible.click()

    @property
    def validate_content_all_content_option(self):
        return self.page.locator("div.dialog-buttons-row > div > a:nth-child(1)")

    def click_validate_content_all_content_option(self):
        return self.validate_content_all_content_option.click()

    @property
    def validate_content_cancel_button(self):
        return self.page.locator("div.dialog-buttons-row > div > a:nth-child(2)")

    def click_validate_content_cancel_button(self):
        return self.validate_content_cancel_button.click()

    @property
    def validation_notification_dialog_box_is_visible(self):
        # Content validation dialog showing the validation progress
        return any(
            "Opening documents with errors..." in inner_text
            for inner_text in self.page.locator(
                "div.notification-list-item-main-row > div.notification-list-item-message"
            ).all_inner_texts()
        )

    @property
    def cannot_activate_poet_dialog_box_is_visible(self):
        # Dialog for missing gitpod.yml file in book repos
        return self.page.is_visible("div > div.notifications-toasts.visible")

    # TOC Editor left panel ------

    @property
    def toc_editor_add_buttons_are_visible(self):
        # Books dropdown, Add Module and Add Subcollection buttons
        return self.page.locator("div.panel-editable > div.controls > div:nth-child(2)")

    @property
    def book_list_dropdown_locator(self):
        return self.child_frame.locator("div.panel-editable > div.controls > select")

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
        return self.child_frame.locator("span.node-title").first

    @property
    def chapter_box_title_input(self):
        return self.child_frame.locator("input.node-title-rename").first

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
        return self.page.get_by_text(
            "Title of new Book Section (Press 'Enter' to confirm or 'Escape' to cancel)",
            exact=True,
        )

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
            "div.panel-editable > div:nth-child(2) > div > div > div > div:nth-child(1) > "
            "div > div > div:nth-child(1)"
        )

    @property
    def subcollection_locator_new_box_title(self):
        # Title of the last newly added item in the chapter list (left panel)
        return self.child_frame.locator("span.node-title").first

    @property
    def subcollection_locator_new_box_title_input(self):
        # Title of the last newly added item in the chapter list (left panel)
        return self.child_frame.locator("input.node-title-rename").first

    def click_new_subcollection_box_title(self):
        self.subcollection_locator_new_box_title.click()

    def fill_new_subcollection_box_title(self, value):
        self.subcollection_locator_new_box_title_input.fill(value)

    @property
    def search_field_locator(self):
        return self.child_frame.locator(
            "div.panel-editable > div.controls > div:nth-child(3) > input"
        )

    def fill_search_field(self, value):
        self.search_field_locator.fill(value)

    @property
    def search_item_amount_indicator_is_visible(self):
        # Search info (how many items search shows)
        return self.child_frame.locator(
            "div.panel-editable > div.controls > div:nth-child(3)"
        )

    # TOC Editor right panel ------

    @property
    def toc_editor_all_modules_dropdown_is_visible(self):
        return self.page.locator("div.controls")

    @property
    def toc_editor_deleted_modules_list_is_visible(self):
        return self.page.locator(
            "div:nth-child(2) > div > div > div > div:nth-child(1)"
        )

    # To stop workspace ----

    @property
    def gitpod_menubar_locator(self):
        return self.page.locator("div.menubar-menu-button")

    def click_gitpod_menubar(self):
        self.gitpod_menubar_locator.click()

    @property
    def stop_workspace_button_locator(self):
        return self.page.get_by_text("Gitpod: Stop Workspace", exact=True)

    def click_stop_workspace_button(self):
        self.stop_workspace_button_locator.click()

    # Menubar items ----

    @property
    def menubar_explorer_button_locator(self):
        return self.page.wait_for_selector(
            "div.composite-bar > div > ul > li:nth-child(1)", timeout=90000
        )

    def click_explorer_button(self):
        self.menubar_explorer_button_locator.click()

    @property
    def explorer_modules_locator(self):
        return self.page.wait_for_selector(
            "div.monaco-list-row :text('modules')", timeout=90000
        )

    def click_explorer_modules(self):
        self.explorer_modules_locator.click()

    @property
    def explorer_submodule_locator(self):
        return self.page.wait_for_selector("id=list_id_1_9", timeout=90000)

    def click_explorer_submodule(self):
        self.explorer_submodule_locator.click()

    @property
    def explorer_index_file_locator(self):
        return self.page.wait_for_selector("id=list_id_1_10", timeout=90000)

    def click_explorer_index_file(self):
        self.explorer_index_file_locator.click()

    def click_problems_tab(self):
        return self.page.get_by_text("Problems", exact=True).click()

    @property
    def problems_tab_message(self):
        return self.page.wait_for_selector(
            "div.pane-body.markers-panel.wide", timeout=90000
        )

    @property
    def private_repo_warning_is_visible(self):
        return self.page.is_visible("span.flex-1.text-left > div:nth-child(1)")

    # To change users in gitpod user dropdown

    @property
    def gitpod_user_dropdown(self):
        return self.page.wait_for_selector("div:nth-child(1) > button:nth-child(1)")

    def click_gitpod_user_dropdown(self):
        self.gitpod_user_dropdown.click()

    @property
    def gitpod_user_selector(self):
        return self.page.wait_for_selector(
            "div:nth-child(1) > button:nth-child(1) :text('openstax')"
        )

    def click_gitpod_user_selector(self):
        self.gitpod_user_selector.click()

    @property
    def continue_with_github_is_visible(self):
        return self.page.is_visible(
            "div > div.w-56.mx-auto.flex.flex-col.space-y-3.items-center > button"
        )

    @property
    def continue_with_github_button(self):
        return self.page.locator("button").get_by_text(
            "Continue with GitHub", exact=True
        )

    def click_continue_with_github_button(self):
        self.continue_with_github_button.click()

    @property
    def continue_with_workspace_is_visible(self):
        return self.page.is_visible("div.flex:nth-child(4)")

    @property
    def continue_with_workspace_button(self):
        return self.page.locator("button").get_by_text("Continue (⌘Enter)", exact=True)

    def click_continue_with_workspace_button(self):
        self.continue_with_github_button.click()

    def wait_for_validation_end(
        self, condition, timeout_seconds=900, interval_seconds=10
    ):
        # Waits for the content validation process to complete (at various times depending on the book repo)
        end = time.time() + timeout_seconds
        while time.time() < end:
            if condition():
                time.sleep(interval_seconds)

            else:
                return True

        raise Exception("Timeout")
