// 全局变量
let currentSessionIndex = 0;
let totalSessions = 0;
let currentSessionData = null;
let currentEditingRow = null;

// DOM 元素
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const uploadSection = document.getElementById('upload-section');
const verificationSection = document.getElementById('verification-section');
const progressText = document.getElementById('progress-text');
const sessionInfo = document.getElementById('session-info');
const sessionContent = document.getElementById('session-content');
const prevSessionBtn = document.getElementById('prev-session');
const nextSessionBtn = document.getElementById('next-session');
const saveSessionBtn = document.getElementById('save-session');
const exportBtn = document.getElementById('export-btn');
const statisticsBar = document.getElementById('statistics-bar');
const conversationType = document.getElementById('conversation-type');
const sessionIdDisplay = document.getElementById('session-id-display');
const modal = document.getElementById('modal');
const modalTextarea = document.getElementById('modal-textarea');
const modalSave = document.getElementById('modal-save');
const modalCancel = document.getElementById('modal-cancel');
const closeModal = document.querySelector('.close');
const messageDiv = document.getElementById('message');

// 事件监听器
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
});

function initializeEventListeners() {
    // 文件选择
    fileInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            uploadBtn.disabled = false;
            document.querySelector('.upload-box p').textContent = `已选择文件: ${file.name}`;
        }
    });

    // 上传按钮
    uploadBtn.addEventListener('click', uploadFile);

    // 对话导航
    prevSessionBtn.addEventListener('click', () => navigateSession(-1));
    nextSessionBtn.addEventListener('click', () => navigateSession(1));

    // 保存会话按钮
    saveSessionBtn.addEventListener('click', saveCurrentSession);
    
    // 导出按钮
    exportBtn.addEventListener('click', exportExcel);

    // 模态框
    closeModal.addEventListener('click', closeModalDialog);
    modalCancel.addEventListener('click', closeModalDialog);
    modalSave.addEventListener('click', saveManualEdit);

    // 点击模态框外部关闭
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeModalDialog();
        }
    });

    // 拖拽上传
    const uploadBox = document.querySelector('.upload-box');
    uploadBox.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.style.borderColor = '#3498db';
    });

    uploadBox.addEventListener('dragleave', function(e) {
        e.preventDefault();
        this.style.borderColor = '#bdc3c7';
    });

    uploadBox.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.borderColor = '#bdc3c7';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            const event = new Event('change');
            fileInput.dispatchEvent(event);
        }
    });
}

// 上传文件
async function uploadFile() {
    const file = fileInput.files[0];
    if (!file) {
        showMessage('请选择文件', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = '上传中...';

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            totalSessions = result.total_sessions;
            showMessage(result.message, 'success');
            uploadSection.style.display = 'none';
            verificationSection.style.display = 'block';
            statisticsBar.style.display = 'flex';
            updateProgress();
            updateStatistics();
            loadSession(0);
        } else {
            showMessage(result.error, 'error');
        }
    } catch (error) {
        showMessage('上传失败: ' + error.message, 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传文件';
    }
}

// 加载对话
async function loadSession(sessionIndex) {
    try {
        const response = await fetch(`/get_session/${sessionIndex}`);
        const data = await response.json();

        if (data.error) {
            showMessage(data.error, 'error');
            return;
        }

        currentSessionIndex = sessionIndex;
        currentSessionData = data;
        renderSession(data);
        updateNavigationButtons();
        updateProgress();
        updateConversationType(data);
        updateSaveButton(data);
        updateSessionId(data);
    } catch (error) {
        showMessage('加载对话失败: ' + error.message, 'error');
    }
}

// 渲染对话
function renderSession(data) {
    sessionContent.innerHTML = '';
    
    data.rows.forEach((row, index) => {
        const rowElement = createRowElement(row, index);
        sessionContent.appendChild(rowElement);
    });
}

// 创建行元素
function createRowElement(row, index) {
    const div = document.createElement('div');
    div.className = 'conversation-row';
    div.dataset.rowIndex = row.index;

    const originalContent = row.original_content || '';
    const updatedContent = row.updated_content || '';
    const manualContent = row.manually_corrected_content || '';

    // 计算差异 - 左右两侧都需要高亮
    const originalDiff = highlightDifferences(originalContent, updatedContent);
    const updatedDiff = highlightDifferencesUpdated(originalContent, manualContent);

    div.innerHTML = `
        <div class="row-header-full">
            <div class="role-label ${row.role === '客户' ? 'role-customer' : 'role-service'}">
                ${row.role}
            </div>
            <div class="header-right-section">
                ${createHorizontalMetadata(row)}
                <div class="row-actions">
                    <button class="btn btn-success" onclick="updateRow(${row.index}, 'accept')">采纳</button>
                    <button class="btn btn-danger" onclick="updateRow(${row.index}, 'reject')">拒绝</button>
                    <button class="btn btn-primary" onclick="editManually(${row.index})">编辑</button>
                </div>
            </div>
        </div>
        <div class="row-content-container">
            <div class="row-left">
                <div class="content-box content-original">
                    ${originalDiff}
                </div>
            </div>
            <div class="row-right">
                <div class="content-box content-updated">
                    ${updatedDiff}
                </div>
            </div>
        </div>
    `;

    return div;
}

// 创建水平排列的元数据显示
function createHorizontalMetadata(row) {
    const items = [];
    
    if (row.update_status) {
        items.push(`<span class="metadata-item"><span class="metadata-label">更新情况:</span> ${row.update_status}</span>`);
    }
    
    if (row.llm_output) {
        const escapedOutput = escapeHtml(row.llm_output);
        items.push(`
            <span class="metadata-item">
                <span class="expandable" onclick="showPopup(event, 'LLM完整输出', '${escapedOutput}')">
                    LLM完整输出 ▼
                </span>
            </span>
        `);
    }
    
    if (row.check_result) {
        items.push(`<span class="metadata-item metadata-check-result"><span class="metadata-label">更新结果检查:</span> ${row.check_result}</span>`);
    }
    
    if (row.check_details) {
        const checkDetailClass = row.check_result ? 'metadata-item metadata-check-result' : 'metadata-item';
        const escapedDetails = escapeHtml(row.check_details);
        items.push(`
            <span class="${checkDetailClass}">
                <span class="expandable" onclick="showPopup(event, '检查详情', '${escapedDetails}')">
                    检查详情 ▼
                </span>
            </span>
        `);
    }

    return items.length > 0 ? `<div class="metadata-horizontal">${items.join('')}</div>` : '<div class="metadata-horizontal"></div>';
}

// 创建紧凑的元数据显示（保留兼容性）
function createCompactMetadata(row) {
    return createHorizontalMetadata(row);
}

// 创建元数据显示（保留原函数以防其他地方使用）
function createMetadata(row) {
    return createCompactMetadata(row);
}

// 按标点符号分割句子
function splitBySentence(text) {
    if (!text) return [];
    // 按照中英文标点符号分割，保留分隔符
    return text.split(/([。！？；，、：,!?;:])/g).filter(part => part.length > 0);
}

// 高亮差异 - 按句子级别对比
function highlightDifferences(originalText, updatedText) {
    if (originalText === updatedText) return originalText;
    
    const originalParts = splitBySentence(originalText);
    const updatedParts = splitBySentence(updatedText);
    
    // 使用动态规划找到最长公共子序列
    const dp = Array(originalParts.length + 1).fill(null).map(() => 
        Array(updatedParts.length + 1).fill(0)
    );
    
    for (let i = 1; i <= originalParts.length; i++) {
        for (let j = 1; j <= updatedParts.length; j++) {
            if (originalParts[i-1] === updatedParts[j-1]) {
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }
    
    // 回溯找到匹配的部分
    const matches = [];
    let i = originalParts.length, j = updatedParts.length;
    
    while (i > 0 && j > 0) {
        if (originalParts[i-1] === updatedParts[j-1]) {
            matches.unshift({orig: i-1, upd: j-1});
            i--; j--;
        } else if (dp[i-1][j] > dp[i][j-1]) {
            i--;
        } else {
            j--;
        }
    }
    
    // 生成带高亮的原文
    let result = '';
    let lastOrigIndex = 0;
    
    for (const match of matches) {
        // 添加不匹配的部分（标红）
        for (let k = lastOrigIndex; k < match.orig; k++) {
            result += `<span class="diff-text">${originalParts[k]}</span>`;
        }
        // 添加匹配的部分（不标红）
        result += originalParts[match.orig];
        lastOrigIndex = match.orig + 1;
    }
    
    // 添加剩余的不匹配部分
    for (let k = lastOrigIndex; k < originalParts.length; k++) {
        result += `<span class="diff-text">${originalParts[k]}</span>`;
    }
    
    return result;
}

// 高亮差异 - 更新后文本
function highlightDifferencesUpdated(originalText, updatedText) {
    if (originalText === updatedText) return updatedText;
    
    const originalParts = splitBySentence(originalText);
    const updatedParts = splitBySentence(updatedText);
    
    // 使用动态规划找到最长公共子序列
    const dp = Array(originalParts.length + 1).fill(null).map(() => 
        Array(updatedParts.length + 1).fill(0)
    );
    
    for (let i = 1; i <= originalParts.length; i++) {
        for (let j = 1; j <= updatedParts.length; j++) {
            if (originalParts[i-1] === updatedParts[j-1]) {
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }
    
    // 回溯找到匹配的部分
    const matches = [];
    let i = originalParts.length, j = updatedParts.length;
    
    while (i > 0 && j > 0) {
        if (originalParts[i-1] === updatedParts[j-1]) {
            matches.unshift({orig: i-1, upd: j-1});
            i--; j--;
        } else if (dp[i-1][j] > dp[i][j-1]) {
            i--;
        } else {
            j--;
        }
    }
    
    // 生成带高亮的更新文本
    let result = '';
    let lastUpdIndex = 0;
    
    for (const match of matches) {
        // 添加不匹配的部分（标红）
        for (let k = lastUpdIndex; k < match.upd; k++) {
            result += `<span class="diff-text">${updatedParts[k]}</span>`;
        }
        // 添加匹配的部分（不标红）
        result += updatedParts[match.upd];
        lastUpdIndex = match.upd + 1;
    }
    
    // 添加剩余的不匹配部分
    for (let k = lastUpdIndex; k < updatedParts.length; k++) {
        result += `<span class="diff-text">${updatedParts[k]}</span>`;
    }
    
    return result;
}

// 更新行
async function updateRow(rowIndex, action, manualContent = '') {
    try {
        const response = await fetch('/update_row', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                row_index: rowIndex,
                action: action,
                manual_content: manualContent
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('更新成功', 'success');
            // 重新加载当前会话以反映更改
            loadSession(currentSessionIndex);
            // 更新统计信息
            updateStatistics();
        } else {
            showMessage(result.error, 'error');
        }
    } catch (error) {
        showMessage('更新失败: ' + error.message, 'error');
    }
}

// 手动编辑
function editManually(rowIndex) {
    currentEditingRow = rowIndex;
    
    // 找到当前行的内容
    const row = currentSessionData.rows.find(r => r.index === rowIndex);
    if (row) {
        modalTextarea.value = row.manually_corrected_content || row.updated_content || row.original_content;
        modal.style.display = 'block';
    }
}

// 保存手动编辑
function saveManualEdit() {
    if (currentEditingRow !== null) {
        updateRow(currentEditingRow, 'manual', modalTextarea.value);
        closeModalDialog();
    }
}

// 关闭模态框
function closeModalDialog() {
    modal.style.display = 'none';
    currentEditingRow = null;
}

// 导航对话
function navigateSession(direction) {
    const newIndex = currentSessionIndex + direction;
    if (newIndex >= 0 && newIndex < totalSessions) {
        loadSession(newIndex);
    }
}

// 更新导航按钮状态
function updateNavigationButtons() {
    prevSessionBtn.disabled = currentSessionIndex <= 0;
    nextSessionBtn.disabled = currentSessionIndex >= totalSessions - 1;
}

// 更新进度显示
function updateProgress() {
    const current = currentSessionIndex + 1;
    sessionInfo.textContent = `第 ${current} 通 / 共 ${totalSessions} 通`;
    progressText.textContent = `正在校验第 ${current} 通对话 (共 ${totalSessions} 通)`;
}

// 导出Excel
async function exportExcel() {
    try {
        exportBtn.disabled = true;
        exportBtn.textContent = '生成中...';

        const response = await fetch('/export');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // 正确解析文件名
            let filename = 'export.xlsx';
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition) {
                // 优先尝试解析 filename*=UTF-8''... 格式
                const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
                if (utf8Match) {
                    filename = decodeURIComponent(utf8Match[1]);
                } else {
                    // 降级到普通 filename="..." 格式
                    const normalMatch = contentDisposition.match(/filename="([^"]+)"/);
                    if (normalMatch) {
                        filename = normalMatch[1];
                    }
                }
            }
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showMessage('导出成功', 'success');
        } else {
            const error = await response.json();
            showMessage(error.error, 'error');
        }
    } catch (error) {
        showMessage('导出失败: ' + error.message, 'error');
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '生成更新后的表格';
    }
}

// 保存当前会话
async function saveCurrentSession() {
    if (!currentSessionData) {
        showMessage('没有当前会话数据', 'error');
        return;
    }

    try {
        saveSessionBtn.disabled = true;
        saveSessionBtn.textContent = '保存中...';

        const response = await fetch('/save_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: currentSessionData.session_id
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('保存成功', 'success');
            // 重新加载当前会话以更新状态
            loadSession(currentSessionIndex);
            // 更新统计信息
            updateStatistics();
        } else {
            showMessage(result.error, 'error');
        }
    } catch (error) {
        showMessage('保存失败: ' + error.message, 'error');
    } finally {
        saveSessionBtn.disabled = false;
        saveSessionBtn.textContent = '保存';
    }
}

// 更新对话类型显示
function updateConversationType(data) {
    const typeText = {
        1: '已保存-无变更',
        2: '已保存-有变更',
        3: '未保存-无变更',
        4: '未保存-有变更'
    };
    
    const typeClass = {
        1: 'type-1',
        2: 'type-2',
        3: 'type-3',
        4: 'type-4'
    };

    conversationType.textContent = typeText[data.conversation_type] || '';
    conversationType.className = `conversation-type ${typeClass[data.conversation_type] || ''}`;
}

// 更新保存按钮状态
function updateSaveButton(data) {
    if (data.is_saved) {
        saveSessionBtn.textContent = '已保存';
        saveSessionBtn.disabled = true;
        saveSessionBtn.className = 'btn btn-secondary';
    } else {
        saveSessionBtn.textContent = '保存';
        saveSessionBtn.disabled = false;
        saveSessionBtn.className = 'btn btn-success';
    }
}

// 更新统计信息
async function updateStatistics() {
    try {
        const response = await fetch('/get_statistics');
        const stats = await response.json();
        
        document.getElementById('stat-saved-no-change').textContent = stats.saved_no_change || 0;
        document.getElementById('stat-saved-has-change').textContent = stats.saved_has_change || 0;
        document.getElementById('stat-unsaved-no-change').textContent = stats.unsaved_no_change || 0;
        document.getElementById('stat-unsaved-has-change').textContent = stats.unsaved_has_change || 0;
    } catch (error) {
        console.error('获取统计信息失败:', error);
    }
}

// 更新SessionId显示
function updateSessionId(data) {
    sessionIdDisplay.textContent = data.session_id || 'Unknown';
}

// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// 显示弹窗
function showPopup(event, title, content) {
    console.log('showPopup called with:', title, content); // 调试信息
    
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // 移除已存在的弹窗
    const existingPopup = document.querySelector('.content-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    // 创建弹窗
    const popup = document.createElement('div');
    popup.className = 'content-popup';
    
    // 安全地创建内容
    const header = document.createElement('div');
    header.className = 'popup-header';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'popup-title';
    titleSpan.textContent = title;
    
    const closeSpan = document.createElement('span');
    closeSpan.className = 'popup-close';
    closeSpan.innerHTML = '&times;';
    
    header.appendChild(titleSpan);
    header.appendChild(closeSpan);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'popup-content';
    contentDiv.textContent = content;
    
    popup.appendChild(header);
    popup.appendChild(contentDiv);
    
    // 设置位置
    const rect = event.target.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 400) + 'px';
    popup.style.top = (rect.bottom + 5) + 'px';
    
    document.body.appendChild(popup);
    
    // 添加关闭事件
    closeSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.remove();
    });
    
    // 点击其他地方关闭
    setTimeout(() => {
        document.addEventListener('click', function closePopup() {
            popup.remove();
            document.removeEventListener('click', closePopup);
        });
    }, 100);
}

// 显示消息
function showMessage(text, type = 'info') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type} show`;
    
    setTimeout(() => {
        messageDiv.classList.remove('show');
    }, 3000);
}
