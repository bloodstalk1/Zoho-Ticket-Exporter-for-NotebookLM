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

    if (!tab.url.includes('zoho') && !tab.url.includes('zohodesk')) {
        setStatus('❌ Lỗi: Tiện ích này chỉ hoạt động trên trang của Zoho Desk!', 'error');
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
    const rows = document.querySelectorAll('table tbody tr, .list-view-row, [class*="ticket-row"], [class*="request-row"]');

    // Fallback: thử đọc theo cấu trúc bảng chuẩn
    let tickets = [];

    // Cách 1: Đọc từ bảng HTML table
    const tableRows = document.querySelectorAll('table tr');
    if (tableRows.length > 1) {
        // Lấy header
        const headers = [];
        tableRows[0].querySelectorAll('th, td').forEach(th => headers.push(th.innerText.trim()));

        for (let i = 1; i < tableRows.length; i++) {
            const cells = tableRows[i].querySelectorAll('td');
            if (cells.length < 3) continue;
            const ticket = {};
            cells.forEach((cell, idx) => {
                ticket[headers[idx] || `col${idx}`] = cell.innerText.trim();
            });
            tickets.push(ticket);
        }
    }

    // Cách 2: Zoho Desk dùng div-based list
    if (tickets.length === 0) {
        const items = document.querySelectorAll('[data-id], [data-ticketid], [class*="ticket-item"]');
        items.forEach(item => {
            const id = item.getAttribute('data-id') || item.getAttribute('data-ticketid') || '';
            const subject = item.querySelector('[class*="subject"], [class*="title"]')?.innerText || '';
            const requester = item.querySelector('[class*="requester"], [class*="contact"]')?.innerText || '';
            const status = item.querySelector('[class*="status"]')?.innerText || '';
            const assignedTo = item.querySelector('[class*="assigned"], [class*="agent"]')?.innerText || '';
            const dueDate = item.querySelector('[class*="due"], [class*="date"]')?.innerText || '';
            tickets.push({ ID: id, SUBJECT: subject, REQUESTER: requester, STATUS: status, 'ASSIGNED TO': assignedTo, 'DUEBY DATE': dueDate });
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