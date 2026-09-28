const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields = {name:'Nazwa przedmiotu', category:'Kategoria', location:'Lokalizacja', sub_location:'Podlokalizacja', quantity:'Ilość', description:'Opis'};

class MyStuffProPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this.items = [];
    this.revision = 0;
    this.loaded = false;
    this.query = '';
    this.page = 'items';
    this.error = '';
    this.busy = false;
    this.loading = false;
    this.theme = localStorage.getItem('mystuffpro-theme') || 'auto';
  }
  set hass(value) {
    this._hass = value;
    this.applyTheme();
    if (this.isConnected && !this.loaded && !this.loading) this.refresh();
  }
  connectedCallback() {
    this.render();
    if (this._hass && !this.loaded) this.refresh();
    // Avoid replacing a form while someone is typing. Revisions protect stale edits.
    this.timer = setInterval(() => {
      if (this.page === 'items' && !this.busy && !document.hidden) this.refresh(true);
    }, 10000);
  }
  disconnectedCallback() { clearInterval(this.timer); }
  applyTheme() {
    this.setAttribute('data-theme', this.theme === 'auto' ? (this._hass?.themes?.darkMode ? 'dark' : 'light') : this.theme);
  }
  async request(action, extra = {}) {
    return this._hass.callWS({type:'mystuffpro/request', action, ...extra});
  }
  accept(data) { this.items = data.items; this.revision = data.revision; this.loaded = true; }
  async refresh(quiet = false) {
    if (!this._hass || this.loading || this.busy) return;
    this.loading = true;
    try {
      const data = await this.request('list');
      const changed = !this.loaded || data.revision !== this.revision || this.error;
      this.accept(data);
      this.error = '';
      if (!quiet || changed) this.render();
    } catch (e) { this.error = e.message || 'Nie można pobrać danych. Sprawdź połączenie z HA.'; this.showError(); }
    finally { this.loading = false; }
  }
  showError() {
    const box = this.shadowRoot.querySelector('#error');
    if (box) { box.textContent = this.error; box.hidden = !this.error; }
  }
  async mutate(action, extra, revision = this.revision) {
    if (this.busy) return false;
    this.busy = true;
    this.shadowRoot.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      this.accept(await this.request(action, {revision, ...extra}));
      this.error = '';
      this.page = 'items';
      this.render();
      return true;
    } catch (e) {
      this.error = e.message || 'Zapis nie powiódł się. Twoje zmiany pozostały w formularzu.';
      this.showError();
      return false;
    } finally {
      this.busy = false;
      this.shadowRoot.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  }
  render() {
    const root = this.shadowRoot;
    root.innerHTML = `<link rel="stylesheet" href="/mystuffpro_static/style.css?v=1.0.0">
      <header class="topbar"><div class="topbar-inner">
        <button class="menu" id="menu" aria-label="Otwórz menu Home Assistant">☰</button>
        <strong class="brand">📦 MyStuffPro</strong>
        <nav class="nav-pill"><button data-page="items" class="${this.page==='items'?'active':''}">Przedmioty</button><button data-page="settings" class="${this.page==='settings'?'active':''}">Ustawienia</button></nav>
      </div></header>
      <main class="main"><p id="error" role="alert" class="error" ${this.error?'':'hidden'}>${escapeHtml(this.error)}</p><div id="content"></div></main>`;
    root.querySelector('#menu').onclick = () => this.dispatchEvent(new CustomEvent('hass-toggle-menu', {bubbles:true,composed:true}));
    root.querySelectorAll('[data-page]').forEach(b => b.onclick = () => {
      this.page = b.dataset.page; this.error = ''; this.render();
      if (this.page === 'items') this.refresh();
    });
    if (this.page === 'edit') this.renderForm();
    else if (this.page === 'settings') this.renderSettings();
    else this.renderItems();
    this.applyTheme();
  }
  renderItems() {
    this.shadowRoot.querySelector('#content').innerHTML = `<div class="page-top"><div><h1>Przedmioty</h1><p class="page-sub">${this.items.length} pozycji · ${this.items.reduce((n,i)=>n+i.quantity,0)} sztuk w Twoim domu</p></div><button class="btn btn-primary" id="add" ${this.loaded?'':'disabled'}>+ Dodaj</button></div>
      <div class="search-box"><input id="search" type="search" aria-label="Szukaj przedmiotów" placeholder="Szukaj po nazwie, kategorii lub lokalizacji…" value="${escapeHtml(this.query)}"><button class="btn btn-ghost" id="refresh">Odśwież</button></div><div id="groups" class="groups"></div>`;
    this.shadowRoot.querySelector('#add').onclick = () => this.edit();
    this.shadowRoot.querySelector('#refresh').onclick = () => this.refresh();
    this.shadowRoot.querySelector('#search').oninput = e => { this.query = e.target.value; this.renderGroups(); };
    this.renderGroups();
  }
  renderGroups() {
    const query = this.query.toLocaleLowerCase('pl');
    const matches = this.items.filter(i => ['name','category','location','sub_location','description'].some(k=>i[k].toLocaleLowerCase('pl').includes(query)));
    const groups = new Map();
    matches.forEach(i => { const key = i.category || 'Bez kategorii'; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(i); });
    const box = this.shadowRoot.querySelector('#groups');
    box.innerHTML = [...groups.keys()].sort((a,b)=>a.localeCompare(b,'pl')).map(category => `<details class="card cat-card" open><summary class="cat-head"><span class="cat-dot"></span><span class="cat-name">${escapeHtml(category)}</span><span class="cat-count">${groups.get(category).length}</span></summary><div class="rows">${groups.get(category).map(i => `<div class="item-row"><div class="item-row-main"><button class="item-name" data-edit="${escapeHtml(i.id)}">${escapeHtml(i.name)}</button><span class="item-loc">${escapeHtml([i.location,i.sub_location].filter(Boolean).join(' · ') || 'Bez lokalizacji')}</span>${i.description?`<span class="item-desc">${escapeHtml(i.description)}</span>`:''}</div><div class="item-row-side"><span class="qty-badge">×${i.quantity}</span><button class="icon-btn" data-edit="${escapeHtml(i.id)}" aria-label="Edytuj ${escapeHtml(i.name)}">✎</button><button class="icon-btn danger" data-delete="${escapeHtml(i.id)}" aria-label="Usuń ${escapeHtml(i.name)}">×</button></div></div>`).join('')}</div></details>`).join('') || `<div class="empty-state"><div class="empty-icon">📦</div><h2>${!this.loaded?'Ładowanie…':query?'Brak wyników':'Tutaj znajdziesz swoje rzeczy'}</h2><p>${query?'Zmień szukaną frazę.':'Dodaj pierwszy przedmiot lub zaimportuj dane w ustawieniach.'}</p></div>`;
    box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>this.edit(this.items.find(i=>i.id===b.dataset.edit)));
    box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
      const item=this.items.find(i=>i.id===b.dataset.delete);
      if(confirm(`Usunąć „${item.name}”? Tej operacji nie można cofnąć.`)) this.mutate('delete',{item_id:item.id});
    });
  }
  edit(item = {}) { this.editing = {...item}; this.editRevision = this.revision; this.page = 'edit'; this.render(); }
  renderForm() {
    const i = this.editing;
    this.shadowRoot.querySelector('#content').innerHTML = `<div class="page-head"><h1>${i.id?'Edytuj przedmiot':'Dodaj przedmiot'}</h1></div><form class="card form-card">${Object.entries(fields).map(([key,label])=>`<div class="form-group"><label for="${key}">${label}</label>${key==='description'?`<textarea id="${key}" name="${key}" maxlength="5000" rows="4">${escapeHtml(i[key])}</textarea>`:`<input id="${key}" name="${key}" ${key==='name'?'required':''} ${key==='quantity'?'type="number" min="1" max="1000000" step="1" required':'type="text" maxlength="200"'} ${['category','location','sub_location'].includes(key)?`list="options-${key}"`:''} value="${escapeHtml(i[key] ?? (key==='quantity'?1:''))}">`}${['category','location','sub_location'].includes(key)?`<datalist id="options-${key}">${[...new Set(this.items.map(item=>item[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pl')).map(v=>`<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`:''}</div>`).join('')}${i.date_added?`<p class="page-sub">Dodano: ${escapeHtml(i.date_added)}</p>`:''}<div class="form-actions"><button type="button" class="btn btn-ghost" id="cancel">Anuluj</button><button type="submit" class="btn btn-primary">Zapisz przedmiot</button></div></form>`;
    this.shadowRoot.querySelector('#cancel').onclick = () => {this.page='items';this.error='';this.render();this.refresh();};
    this.shadowRoot.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const item=Object.fromEntries(new FormData(e.target)); item.quantity=Number(item.quantity);
      await this.mutate('save',{item,...(i.id?{item_id:i.id}:{})},this.editRevision);
    };
  }
  renderSettings() {
    this.shadowRoot.querySelector('#content').innerHTML = `<h1>Ustawienia</h1><section class="card settings-card"><div class="card-head-block"><h2>Wygląd</h2></div><div class="setting-row"><label for="theme">Motyw</label><select id="theme" class="select-pill"><option value="auto">Jak w Home Assistant</option><option value="light">Jasny</option><option value="dark">Ciemny</option></select></div></section>
      <section class="card settings-card"><div class="card-head-block"><h2>Twoje dane</h2><p>Wspólny inwentarz domowników, zapisany w Home Assistant.</p></div><div class="setting-row"><div><strong>Kopia zapasowa</strong><p class="page-sub">Pobierz wszystkie przedmioty w formacie JSON.</p></div><button class="btn btn-primary" id="export">Eksportuj</button></div>${this._hass?.user?.is_admin?`<div class="setting-row"><div><label for="import"><strong>Import danych</strong></label><p class="page-sub">Wybierz kopię MyStuffPro lub plik items.json ze starej strony (maks. 5 MB).</p></div><input id="import" type="file" accept=".json,application/json"></div><div class="setting-row"><label><input type="checkbox" id="replace"> Zastąp cały inwentarz danymi z pliku</label></div><p class="page-sub">Domyślnie import dopisuje przedmioty. Ponowny import tego samego pliku utworzy duplikaty.</p>`:'<p>Import kopii zapasowej jest dostępny dla administratora.</p>'}</section><p class="app-footer">MyStuffPro 1.0.0</p>`;
    const theme=this.shadowRoot.querySelector('#theme'); theme.value=this.theme;
    theme.onchange=()=>{this.theme=theme.value;localStorage.setItem('mystuffpro-theme',this.theme);this.applyTheme();};
    this.shadowRoot.querySelector('#export').onclick=async()=>{
      try {
        const data=await this.request('list');
        const blob=new Blob([JSON.stringify({format:'mystuffpro',version:1,exported_at:new Date().toISOString(),items:data.items},null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url;a.download=`mystuffpro-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      } catch(e) {this.error=e.message||'Eksport nie powiódł się.';this.showError();}
    };
    const input=this.shadowRoot.querySelector('#import');
    if(input) input.onchange=async()=>{
      const file=input.files[0]; if(!file)return;
      try {
        if(file.size>5*1024*1024)throw new Error('Plik przekracza limit 5 MB.');
        const data=JSON.parse(await file.text());
        const items=Array.isArray(data)?data:data.items;
        if(!Array.isArray(items))throw new Error('Plik nie zawiera listy przedmiotów.');
        const replace=this.shadowRoot.querySelector('#replace').checked;
        if(!confirm(`${replace?'Zastąpić cały inwentarz':'Dopisać do inwentarza'}: ${items.length} pozycji?${replace?' Najpierw warto wyeksportować bieżące dane.':''}`))return;
        await this.mutate('import',{data,replace});
      }catch(e){this.error=e.message||'Import nie powiódł się.';this.showError();}
      finally{input.value='';}
    };
  }
}
if (!customElements.get('mystuffpro-panel')) customElements.define('mystuffpro-panel',MyStuffProPanel);
