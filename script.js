document.addEventListener('DOMContentLoaded', () => {
    let fileSystem = { root: [], friends: [] };
    let commandQueue = JSON.parse(localStorage.getItem('fs_queue')) || [];
    let currentUser = "user";
    let draggedFile = null;
    const treeContainer = document.getElementById('file-tree');
    const viewerPanel = document.getElementById('viewer-panel');
    const syncBtn = document.getElementById('sync-btn');
    const trashZone = document.getElementById('trash-zone');
    init();
    function init() {
        document.getElementById('startup-overlay').onclick = function() {
            this.style.display = 'none';
        }
        setIdentity();
        updateSyncButton();
        fetch('data.json')
            .then(res => res.json())
            .then(data => {
                fileSystem = data;
                renderAll();
            })
            .catch(err => console.error("Error loading filesystem:", err));
        setupTrash();
    }
    function setIdentity() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        let displayUser = "local_dev";
        let displayHost = "localhost";
        if (hostname.includes('github.io')) {
            displayUser = hostname.split('.')[0];
            const repo = pathname.replace(/^\/|\/$/g, ''); 
            displayHost = repo || 'github';
        }
        currentUser = displayUser;
        const prompt = `${displayUser}@${displayHost}:~/bookmarks`;
        document.querySelector('.user-host').textContent = prompt;
        document.title = prompt;
    }
    function renderAll() {
        treeContainer.innerHTML = '';
        renderTree(fileSystem.root, treeContainer);
        if (fileSystem.friends && fileSystem.friends.length > 0) {
            const mnt = createFolderDOM('mnt (friends)', false);
            mnt.classList.add('read-only-zone');
            const nested = mnt.querySelector('.nested');
            fileSystem.friends.forEach(f => mountFriend(f, nested));
            treeContainer.appendChild(mnt);
        }
    }
    function renderTree(items, container) {
        if (!items) return;
        items.forEach(item => {
            if (item.type === 'folder') {
                const folderDiv = createFolderDOM(item.name);
                const titleDiv = folderDiv.querySelector('.tree-item');
                setupDropZone(titleDiv, (droppedUrl) => {
                    handleMove(droppedUrl, item.name);
                });
                container.appendChild(folderDiv);
                renderTree(item.children, folderDiv.querySelector('.nested'));
            } else {
                const file = document.createElement('div');
                file.className = 'tree-item file';
                file.textContent = item.name;
                file.draggable = true;
                file.addEventListener('dragstart', (e) => {
                    draggedFile = item;
                    e.dataTransfer.setData('text/plain', item.url);
                    file.style.opacity = '0.5';
                });
                file.addEventListener('dragend', () => {
                    file.style.opacity = '1';
                    draggedFile = null;
                });
                file.onclick = () => loadFileDetails(item);
                container.appendChild(file);
            }
        });
    }
    function createFolderDOM(name, open=false) {
        const div = document.createElement('div');
        const title = document.createElement('div');
        title.className = `tree-item folder ${open?'open':''}`;
        title.textContent = name;
        const nested = document.createElement('div');
        nested.className = `nested ${open?'active':''}`;
        title.onclick = (e) => {
            title.classList.toggle('open');
            nested.classList.toggle('active');
        };
        div.append(title, nested);
        return div;
    }
    function setupDropZone(element, callback) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('drag-over');
        });
        element.addEventListener('dragleave', () => {
            element.classList.remove('drag-over');
        });
        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
            const url = e.dataTransfer.getData('text/plain');
            if(draggedFile && draggedFile.url === url) {
                callback(url);
            }
        });
    }
    function setupTrash() {
        setupDropZone(trashZone, (url) => {
            if(confirm("Delete this bookmark?")) {
                handleDelete(url);
            }
        });
    }
    function handleMove(url, targetFolderName) {
        queueAction({ type: 'move', url: url, target: targetFolderName });
        alert(`Move queued! Sync to finalize moving ${draggedFile.name} to ${targetFolderName}.`);
    }
    function handleDelete(url) {
        const removeNode = (items) => {
            const idx = items.findIndex(i => i.url === url);
            if(idx > -1) { items.splice(idx, 1); return true; }
            for(let item of items) {
                if(item.type === 'folder' && item.children) {
                    if(removeNode(item.children)) return true;
                }
            }
            return false;
        };
        removeNode(fileSystem.root);
        renderAll();
        queueAction({ type: 'delete', url: url });
    }
    function loadFileDetails(file) {
        const isReadOnly = !JSON.stringify(fileSystem.root).includes(JSON.stringify(file));
        const domain = new URL(file.url).hostname;
        const iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        const myReviewObj = (file.reviews || []).find(r => r.user === currentUser) || { text: '' };
        const otherReviews = (file.reviews || []).filter(r => r.user !== currentUser);
        const html = `
            <div class="file-content" data-url="${file.url}">
                <div class="file-header">
                    <img src="${iconUrl}" class="favicon">
                    <div>
                        <h1 class="file-title">${file.title}</h1>
                        <a href="${file.url}" target="_blank" class="visit-link">[ ${file.url} ]</a>
                    </div>
                </div>
                <div class="review-section">
                    <h3>// MY REVIEW ${!isReadOnly ? `<button onclick="saveCurrentReview()" class="action-btn">Save to Queue</button>` : ''}</h3>
                    <div id="editor-review" contenteditable="${!isReadOnly}" class="review-text">${myReviewObj.text}</div>
                </div>
                <div class="review-section">
                    <h3>// OTHER REVIEWS</h3>
                    <div style="font-size:0.9rem; color:#888;">
                        ${otherReviews.length ? otherReviews.map(r => `<p><span class="reviewer-tag">@${r.user}:</span> ${r.text}</p>`).join('') : 'No other reviews.'}
                    </div>
                </div>
                ${!isReadOnly ? `<div class="file-controls"><button class="btn-merge" onclick="tryMerge('${file.url}')">⚡ Merge to Archive</button></div>` : ''}
            </div>
        `;
        viewerPanel.innerHTML = html;
    }
    function queueAction(cmd) {
        commandQueue.push(cmd);
        localStorage.setItem('fs_queue', JSON.stringify(commandQueue));
        updateSyncButton();
    }
    function updateSyncButton() {
        if(commandQueue.length > 0) {
            syncBtn.style.display = 'block';
            syncBtn.textContent = `⚠ Sync ${commandQueue.length} Changes`;
        } else {
            syncBtn.style.display = 'none';
        }
    }
    const modal = document.getElementById('modal-overlay');
    document.getElementById('add-btn').onclick = () => modal.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('modal-save').onclick = () => {
        const url = document.getElementById('inp-url').value;
        const title = document.getElementById('inp-title').value || url;
        const folderName = document.getElementById('inp-folder').value;
        if(!url) return;
        const newFile = {
            name: title.replace(/\s+/g, '-').toLowerCase() + '.lnk',
            type: 'file', url: url, title: title, reviews: [], points: []
        };
        const folder = fileSystem.root.find(f => f.name === folderName);
        if(folder) folder.children.push(newFile);
        renderAll();
        queueAction({ type: 'add', folder: folderName, payload: newFile });
        modal.classList.add('hidden');
    };
    window.saveCurrentReview = () => {
        const url = document.querySelector('.file-content').dataset.url;
        const text = document.getElementById('editor-review').innerText;
        queueAction({ type: 'review', url: url, user: currentUser, text: text });
        alert("Review queued!");
    };
    window.tryMerge = (url) => {
        queueAction({ type: 'merge', url: url });
        alert("Merge queued!");
    };
    syncBtn.onclick = () => {
        if(!confirm(`Push ${commandQueue.length} changes to GitHub?`)) return;
        const payload = { commands: commandQueue };
        const hostname = window.location.hostname;
        const pathname = window.location.pathname.replace(/^\/|\/$/g, '');
        const user = hostname.split('.')[0];
        const repo = pathname || 'bookmarks';
        const repoPath = `${user}/${repo}`;
        const body = encodeURIComponent(JSON.stringify(payload));
        const issueUrl = `https://github.com/${repoPath}/issues/new?title=batch:update&body=${body}`;
        window.open(issueUrl, '_blank');
        commandQueue = [];
        localStorage.removeItem('fs_queue');
        updateSyncButton();
    };
    function mountFriend(friend, container) {
        fetch(friend.url).then(res=>res.json()).then(data=>{
            const friendRoot = document.createElement('div');
            renderTree(data.root, friendRoot);
            container.appendChild(friendRoot);
        });
    }
});