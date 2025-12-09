# Privacy Policy - Dynamic View Downloader

Last updated: December 2024

## Overview

Dynamic View Downloader (hereinafter referred to as "this extension") respects and protects user privacy. This privacy policy explains how this extension collects, uses, and protects your information.

## Data Collection

### Data Collected by This Extension

1. **User Configuration**
   - Cloud server endpoint URL
   - API Key
   
   This information is voluntarily entered by users and stored in Chrome browser's local sync storage, solely used to implement the "Publish to Cloud" feature.

2. **Page Content**
   - When users actively trigger the "Save Page" feature, the extension temporarily reads the current page's HTML content and resources (images, CSS, JS)
   - This data is only used to generate offline HTML files and is not stored or transmitted to the extension developer's servers

### Data NOT Collected by This Extension

- Browsing history
- Personal identification information
- Login credentials
- Any automatically collected background data

## Data Usage

- **Local Save**: Generated HTML files are saved to the user's local device
- **Cloud Upload**: If users configure a cloud server and choose "Publish to Cloud", page content is uploaded to **the user's own specified server**, not the extension developer's server

## Data Sharing

This extension does not share user data with any third parties. All data processing is completed within the user's local browser.

The cloud upload feature only sends data to the server address configured by the user. The extension developer cannot access this data.

## Data Storage

User configuration is stored in Chrome browser's `chrome.storage.sync` and syncs with the user's Google account. Users can modify or delete this configuration at any time in the extension settings page.

## Permissions

Browser permissions requested by this extension are only used to implement core functionality:
- Read page content to generate offline HTML
- Download files to local storage
- Store user configuration

## Children's Privacy

This extension does not target children under 13 years of age and does not intentionally collect personal information from children.

## Policy Changes

If there are any changes to this privacy policy, we will update this page.

## Contact

If you have any questions about this privacy policy, please contact us through:

- GitHub: https://github.com/benzfy/gemini-dynamic-view-downloader.git
