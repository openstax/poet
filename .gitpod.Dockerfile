# From https://community.gitpod.io/t/is-there-an-easy-way-to-debug-a-vscode-extension-inside-gitpod/596/63
FROM gitpod/workspace-full-vnc

ARG DEBIAN_FRONTEND=noninteractive

# Install vscode and cypress dependencies
RUN wget -q https://packages.microsoft.com/keys/microsoft.asc -O- | sudo apt-key add -; \
    sudo add-apt-repository "deb [arch=amd64] https://packages.microsoft.com/repos/vscode stable main" \
    && sudo apt-get update \
    && sudo apt-get install --no-install-recommends -y libx11-xcb1 libasound2 x11-apps libice6 libsm6 libxaw7 libxft2 libxmu6 libxpm4 libxt6 x11-apps xbitmaps \
    && sudo apt-get install --no-install-recommends -y libgtk2.0-0 libgtk-3-0 libgbm-dev libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2 libxtst6 xauth xvfb \
    && sudo apt-get install -y code
