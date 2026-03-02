document.getElementById('btnExport').addEventListener('click', () => runAction('export'));
document.getElementById('btnPreview').addEventListener('click', () => runAction('preview'));

function getFilters() {
    return {
        status: document.getElementById('filterStatus').value,
        office: document.getElementById('filterOffice').value.trim().toLowerCase(),
        assigned: document.getElementById('filterAssigned').value.trim().toLowerCase(),
        dateFrom: document.getElementById('filterDateFrom').value,
        dateTo: document.getElementById('filterDateTo').value,
        keyword: document.getElementById('filterKeyword').value.trim().toLowerCase(),
    };
}

function setStatus(msg, type = '') {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = type;
}

async function runAction(action) {
    setStatus('⏳ Đang đọc dữ liệu trang...');
    const filters = getFilters();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        setStatus('❌ Lỗi: Hãy chuyển sang tab Zoho Desk để sử dụng tiện ích!', 'error');
        return;
    }

    chrome.scripting.executeScript(
        {
            target: { tabId: tab.id },
            func: scrapeTickets,
            args: [filters, action],
        },
        (results) => {
            if (chrome.runtime.lastError) {
                setStatus('❌ Lỗi: ' + chrome.runtime.lastError.message, 'error');
                return;
            }
            const result = results?.[0]?.result;
            if (!result) {
                setStatus('❌ Không đọc được dữ liệu. Hãy mở trang Zoho Desk!', 'error');
                return;
            }
            if (action === 'preview') {
                setStatus(`✅ Tìm thấy ${result.count} ticket phù hợp`, 'success');
            } else {
                if (result.count === 0) {
                    setStatus('⚠️ Không có ticket nào phù hợp với filter!', 'error');
                } else {
                    downloadMarkdown(result.markdown, result.count);
                    setStatus(`✅ Đã export ${result.count} tickets!`, 'success');
                }
            }
        }
    );
}

function downloadMarkdown(content, count) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    chrome.downloads.download({
        url,
        filename: `zoho-tickets-${date}-${count}tickets.md`,
        saveAs: false,
    });
}

// ---- Hàm này chạy trong context của trang Zoho ----
function scrapeTickets(filters, action) {
    let tickets = [];

    // ==========================================
    // 1. Phân tích giao diện danh sách (List View) 
    // ==========================================
    const listTable = document.querySelector('table#requests_list');
    const kanbanList = document.querySelector('#requests_list_kanban_div');

    if (listTable) {
        // Cách 1: Giao diện Table View
        const tableRows = listTable.querySelectorAll('tr.tc-row');
        const headerCells = listTable.querySelectorAll('thead th');
        const headers = [];
        headerCells.forEach(th => headers.push(th.innerText.trim()));

        tableRows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;
            const ticket = {};
            cells.forEach((cell, idx) => {
                let columnName = headers[idx] || `col${idx}`;
                // Lọc bỏ rác từ nội dung (icons/newlines thừa)
                let cellValue = cell.innerText.trim().replace(/\n+/g, ' ');
                ticket[columnName.toUpperCase()] = cellValue;
            });
            // Thêm ID tĩnh nếu không bị mapping đè
            ticket['ID'] = row.getAttribute('data-entityid') || ticket['ID'];
            tickets.push(ticket);
        });

    } else if (kanbanList) {
        // Cách 2: Giao diện Kanban / Classic View
        const items = kanbanList.querySelectorAll('.tc-row, .cv-task-item');
        items.forEach(item => {
            const id = item.getAttribute('data-entityid') || '';
            const textContent = item.innerText || '';
            // Kanban view của Zoho thường gộp HTML phức tạp, dùng innerText rồi regex hoặc tìm anchor title

            // Lấy subject từ tooltip của thẻ strong/span (đáng tin cậy nhất)
            const subjectEl = item.querySelector('[title*="Subject :"], .truncate-wrapper');
            let subject = subjectEl ? (subjectEl.innerText.trim().replace(/^#\d+\s*/, '')) : '';

            // Tìm requester
            const requesterEl = Array.from(item.querySelectorAll('.text-overflow')).find(el => el.title && el.title !== subject && el.innerText.trim() === el.title);
            let requester = requesterEl ? requesterEl.innerText.trim() : '';

            // Status / date mập mờ trong kanban, tạm đọc từ text thô
            let dueDate = '';
            const datesMatch = textContent.match(/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}\s[AP]M/);
            if (datesMatch) dueDate = datesMatch[0];

            tickets.push({
                'ID': id,
                'SUBJECT': subject,
                'REQUESTER': requester,
                'DUEBY DATE': dueDate,
                'RAW_TEXT': textContent.substring(0, 100) + '...' // Lấy 1 đoạn đại diện
            });
        });
    }

    // ==========================================
    // 2. Phân tích giao diện chi tiết (Detail View)
    // ==========================================
    const detailView = document.querySelector('#req_subject');
    if (!listTable && !kanbanList && detailView) {
        const ticketIdMatches = document.title.match(/\[?#(\d+)\]?/);
        const ticketId = ticketIdMatches ? ticketIdMatches[1] : '';
        const subjectEl = document.querySelector('#req_subject');

        // Extract properties from RHS panel
        const requesterEl = document.querySelector('[data-cs-field="requester"]');
        const statusEl = document.querySelector('[data-cs-field="status"]');

        // Extract Description
        const descIframe = document.querySelector('#current_description iframe');
        let description = '';
        if (descIframe && descIframe.contentDocument) {
            description = descIframe.contentDocument.body.innerText.trim();
        } else {
            const descDiv = document.querySelector('[data-name="description"] > div, #current_description');
            if (descDiv) description = descDiv.innerText.trim();
        }

        tickets.push({
            'ID': ticketId,
            'SUBJECT': subjectEl ? subjectEl.innerText.trim() : '',
            'REQUESTER': requesterEl ? requesterEl.innerText.trim() : '',
            'STATUS': statusEl ? statusEl.innerText.trim() : '',
            'DESCRIPTION': description.replace(/\s+/g, ' ')
        });
    }

    // === APPLY FILTERS ===
    const filtered = tickets.filter(t => {
        const status = (t['STATUS'] || t['Status'] || '').trim();
        const requester = (t['REQUESTER'] || t['Requester'] || '').toLowerCase();
        const assigned = (t['ASSIGNED TO'] || t['Assigned To'] || '').toLowerCase();
        const subject = (t['SUBJECT'] || t['Subject'] || '').toLowerCase();
        const createdDate = (t['CREATED DATE'] || t['Created Date'] || t['DUEBY DATE'] || '').trim();

        if (filters.status !== 'all' && status !== filters.status) return false;
        if (filters.office && !requester.includes(filters.office)) return false;
        if (filters.assigned && !assigned.includes(filters.assigned)) return false;
        if (filters.keyword && !subject.includes(filters.keyword)) return false;

        if (filters.dateFrom || filters.dateTo) {
            const dateStr = createdDate.split(' ')[0];
            if (filters.dateFrom && dateStr < filters.dateFrom) return false;
            if (filters.dateTo && dateStr > filters.dateTo) return false;
        }

        return true;
    });

    if (action === 'preview') return { count: filtered.length };

    // === GENERATE MARKDOWN ===
    const today = new Date().toISOString().slice(0, 10);
    let md = `# Zoho Desk - Ticket Export\n`;
    md += `**Export date:** ${today}  \n`;
    md += `**Total tickets:** ${filtered.length}  \n`;
    if (filters.status !== 'all') md += `**Filter status:** ${filters.status}  \n`;
    if (filters.office) md += `**Filter office:** ${filters.office}  \n`;
    if (filters.keyword) md += `**Filter keyword:** ${filters.keyword}  \n`;
    md += `\n---\n\n`;

    filtered.forEach((t, idx) => {
        const id = t['ID'] || t['Id'] || `#${idx + 1}`;
        const subject = t['SUBJECT'] || t['Subject'] || '(no subject)';
        const requester = t['REQUESTER'] || t['Requester'] || '-';
        const assigned = t['ASSIGNED TO'] || t['Assigned To'] || '-';
        const status = t['STATUS'] || t['Status'] || '-';
        const dueDate = t['DUEBY DATE'] || t['Due Date'] || '-';
        const createdDate = t['CREATED DATE'] || t['Created Date'] || '-';

        md += `## Ticket #${id} — ${subject}\n\n`;
        md += `| Field | Value |\n|---|---|\n`;
        md += `| **Status** | ${status} |\n`;
        md += `| **Requester (Office)** | ${requester} |\n`;
        md += `| **Assigned To** | ${assigned} |\n`;
        md += `| **Due Date** | ${dueDate} |\n`;
        md += `| **Created Date** | ${createdDate} |\n`;

        // Extra fields if available
        Object.keys(t).forEach(key => {
            const skip = ['ID', 'Id', 'SUBJECT', 'Subject', 'REQUESTER', 'Requester',
                'ASSIGNED TO', 'Assigned To', 'STATUS', 'Status',
                'DUEBY DATE', 'Due Date', 'CREATED DATE', 'Created Date', 'col0'];
            if (!skip.includes(key) && t[key]) {
                md += `| **${key}** | ${t[key]} |\n`;
            }
        });

        md += `\n---\n\n`;
    });

    return { count: filtered.length, markdown: md };
}