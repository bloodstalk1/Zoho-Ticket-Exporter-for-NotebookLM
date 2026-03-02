# Zoho Ticket Exporter for NotebookLM

A Chrome extension designed to extract ticket list and detail data from Zoho ServiceDesk Plus (SDP) into clean text formats optimized for ingestion by Google NotebookLM.

## Quick Start

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing this project.
5. Navigate to your Zoho ServiceDesk Plus instance and open the extension.

## Features

- **List View Extraction:** Extract visible tickets from Zoho SDP's Table View or Kanban View.
- **Detail View Extraction:** Extract details (subject, requester, status, conversation, etc.) of a specific ticket in Zoho SDP.
- **NotebookLM Optimized:** Bypasses messy DOM structures and scripts to extract pure text content for LLM use.
- **Filter and Export:** Apply simple filters to the data and directly download it as a markdown file.

## Usage

1. Go to Zoho ServiceDesk Plus, viewing either the ticket list or a specific ticket.
2. Click the extension icon.
3. Fill out any desired filters (Status, Branch, Requester Name, Keyword).
4. Tap **Preview** to see the matches or **Export Markdown** to download the text payload.

## Structure

- `manifest.json`: Chrome extension metadata targeting Manifest V3.
- `popup.html` / `popup.js`: Defines the extension popup UI and the primary DOM scraping scripts.
- `content.js`: Injects necessary scripts into the Zoho page context.

## License

MIT
