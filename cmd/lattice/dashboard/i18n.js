// lattice dashboard - translations. Loaded before app.js, no build step.
//
// Every user-visible string in the dashboard lives here, in en and pt-BR.
// Static markup carries the key in a data-i18n* attribute; dynamic strings go
// through LatticeI18n.t(). Plural entries are { one, other } and interpolate
// {n} (and any other {name}) from the vars object.
(() => {
  'use strict';

  const en = {
    'nav.workspace': 'Workspace',
    'nav.configuration': 'Configuration',
    'nav.home': 'home',
    'nav.shared': 'shared',
    'nav.sharing': 'sharing',
    'nav.settings': 'settings',

    'page.home': 'Home',
    'page.shared': 'Shared',
    'page.sharing': 'Sharing',
    'page.settings': 'Settings',
    'page.summary': 'summary',

    'search.placeholder': 'Search',
    'search.aria': 'Search the library',
    'search.hint': 'Type to search the library',
    'search.none': 'No results',
    'search.results': { one: '{n} result for “{q}”', other: '{n} results for “{q}”' },

    'theme.system': 'System',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.title': 'Theme: {name} — click to cycle',
    'theme.aria': 'Theme: {name}. Click to cycle.',

    'reader.share': 'Share',
    'reader.share.title': 'Share this summary at a public URL',
    'reader.raw': 'Raw',
    'reader.raw.title': 'Original file, no injected code',
    'reader.download': 'Download',
    'reader.download.title': 'Download original',
    'reader.frame': 'summary',
    'github.title': 'lattice on GitHub',

    'home.count': { one: '{n} summary', other: '{n} summaries' },
    'home.empty': 'No summaries yet. <code>lattice add &lt;file.html&gt;</code>',
    'row.missing': 'missing',
    'date.today': 'Today',
    'date.yesterday': 'Yesterday',
    'date.week': 'This week',
    'date.daysAgo': { one: '{n} day ago', other: '{n} days ago' },
    'date.unknown': 'Undated',

    'library.group': 'Group',
    'library.group.aria': 'Group library by',
    'library.group.project': 'Project',
    'library.group.date': 'Date',
    'library.group.none': 'None',
    'library.sort': 'Sort',
    'library.sort.aria': 'Sort library by',
    'library.sort.newest': 'Newest',
    'library.sort.oldest': 'Oldest',
    'library.sort.title': 'Title',
    'library.tags.aria': 'Filter by tag',
    'library.tags.more': '+{n}',
    'library.tags.less': 'Less',
    'library.project.unknown': 'Other',
    'library.project.count': '{name} · {n}',
    'library.peek': 'Preview',

    'shared.count': { one: '{n} share', other: '{n} shares' },
    'shared.votes': { one: '{n} vote', other: '{n} votes' },
    'shared.loading': 'Loading…',
    'shared.error.load': 'Could not load shares',
    'shared.error.empty': 'Could not load shared summaries.',
    'shared.unconfigured': 'Sharing is not configured yet.<br>Add an access token on <a href="#/sharing">sharing</a>, or run <code>lattice login</code>.',
    'shared.none': 'Nothing shared yet.<br>Open a summary and use Share, or check <a href="#/sharing">sharing</a> settings.',
    'shared.copy': 'Copy URL',
    'shared.copied': 'Copied',
    'shared.openPublic': 'Open public',
    'shared.openReader': 'Open in reader',
    'shared.stop': 'Stop sharing',
    'shared.stopping': 'Stopping…',

    'share.lede.off': 'Publish a snapshot of this summary at a public URL. The dashboard, API, and every other summary stay private.',
    'share.random': 'Random subdomain',
    'share.publish': 'Share publicly',
    'share.publishing': 'Sharing…',
    'share.lede.on': 'Live. Anyone with the link can view and vote. Only this summary is reachable.',
    'share.copy': 'Copy',
    'share.copied': 'Copied',
    'share.open': 'Open',
    'share.stop': 'Stop sharing',
    'share.stopping': 'Stopping…',
    'share.tally': { one: '{n} vote. Tally with ', other: '{n} votes. Tally with ' },
    'share.loading': 'Loading…',

    'form.save': 'Save changes',
    'form.unsaved': 'Unsaved changes',
    'form.loading': 'Loading…',
    'form.saving': 'Saving…',
    'form.saved': 'Changes saved',
    'form.error.load': 'Could not load config',
    'form.error.save': 'Could not save config',
    'form.error.accent': 'Accent must be a six-digit hex color',

    'sharing.lede': 'Public snapshots go to lattice.pub. The local library works without a token — add one only when you want to publish.',
    'sharing.api.label': 'API base',
    'sharing.api.hint': 'Hosted service or self-hosted endpoint',
    'sharing.token.label': 'Access token',
    'sharing.token.hint': 'Stored locally · or <code>lattice login</code>',
    'sharing.token.placeholder': 'Not configured',
    'sharing.foot': 'Config file <code>~/.summaries/.lattice</code>',

    'settings.interface.lede': 'Dashboard interface language. Applied instantly and stored in this browser.',
    'settings.language.label': 'Language',
    'lang.system': 'System (automatic)',
    'lang.pt': 'Português (Brasil)',
    'lang.en': 'English',

    'settings.lede': 'Appearance for new HTML summaries from the Lattice skill. Existing files are never rewritten.',
    'settings.preset.label': 'Preset',
    'settings.preset.default': 'Lattice default',
    'settings.preset.warm': 'Warm paper',
    'settings.preset.mono': 'Strict mono',
    'settings.tone.label': 'Page tone',
    'settings.tone.hint': 'Cooler bases avoid the yellowish paper look',
    'settings.tone.default': 'Lattice white',
    'settings.tone.neutral': 'Neutral',
    'settings.tone.zinc': 'Zinc',
    'settings.tone.mist': 'Mist',
    'settings.font.label': 'Body',
    'settings.font.hint': 'Running prose',
    'settings.heading.label': 'Heading',
    'settings.heading.hint': 'Titles & big numbers',
    'settings.heading.inherit': 'Same as body',
    'settings.font.mono': 'Mono',
    'settings.font.sans': 'Sans',
    'settings.font.serif': 'Serif',
    'settings.density.label': 'Density',
    'settings.density.compact': 'Compact',
    'settings.density.comfortable': 'Comfortable',
    'settings.density.spacious': 'Spacious',
    'settings.dividers.label': 'Dividers',
    'settings.dividers.hint': 'Borders & separators',
    'settings.dividers.hairline': 'Hairline',
    'settings.dividers.soft': 'Soft',
    'settings.dividers.none': 'None',
    'settings.modules.label': 'Modules',
    'settings.modules.hint': 'Peers together or apart',
    'settings.modules.mixed': 'Mixed',
    'settings.modules.cards': 'Apart (cards)',
    'settings.modules.stacks': 'Together (stacks)',
    'settings.accent.label': 'Accent',
    'settings.accent.hint': 'Optional color for links and emphasis',
    'settings.accent.aria': 'Choose accent color',
    'settings.accent.hexAria': 'Accent hex color',
    'settings.accent.clear': 'Clear',

    'preview.aria': 'Theme preview',
    'preview.label': 'Live preview',
    'preview.kicker': 'System review / 07',
    'preview.title': 'Signals worth keeping.',
    'preview.body': 'A concise record of decisions, evidence, and the path forward.',
    'preview.stat1': 'current cost',
    'preview.stat2': 'already cut',
    'preview.stat3': 'target',
    'preview.step1': 'Send it all at once',
    'preview.step2': 'Close the diagnosis',
    'preview.step3': 'One source of truth',
    'preview.status': 'Ready for review',
  };

  const pt = {
    'nav.workspace': 'Workspace',
    'nav.configuration': 'Configuração',
    'nav.home': 'página inicial',
    'nav.shared': 'compartilhados',
    'nav.sharing': 'compartilhamento',
    'nav.settings': 'configurações',

    'page.home': 'Página inicial',
    'page.shared': 'Compartilhados',
    'page.sharing': 'Compartilhamento',
    'page.settings': 'Configurações',
    'page.summary': 'sumário',

    'search.placeholder': 'Buscar',
    'search.aria': 'Buscar na biblioteca',
    'search.hint': 'Digite para buscar na biblioteca',
    'search.none': 'Nenhum resultado',
    'search.results': { one: '{n} resultado para “{q}”', other: '{n} resultados para “{q}”' },

    'theme.system': 'Sistema',
    'theme.light': 'Claro',
    'theme.dark': 'Escuro',
    'theme.title': 'Tema: {name} — clique para alternar',
    'theme.aria': 'Tema: {name}. Clique para alternar.',

    'reader.share': 'Compartilhar',
    'reader.share.title': 'Publicar este sumário numa URL pública',
    'reader.raw': 'Original',
    'reader.raw.title': 'Arquivo original, sem código injetado',
    'reader.download': 'Baixar',
    'reader.download.title': 'Baixar o arquivo original',
    'reader.frame': 'sumário',
    'github.title': 'lattice no GitHub',

    'home.count': { one: '{n} sumário', other: '{n} sumários' },
    'home.empty': 'Nenhum sumário ainda. <code>lattice add &lt;arquivo.html&gt;</code>',
    'row.missing': 'sumiu',
    'date.today': 'Hoje',
    'date.yesterday': 'Ontem',
    'date.week': 'Esta semana',
    'date.daysAgo': { one: 'há {n} dia', other: 'há {n} dias' },
    'date.unknown': 'Sem data',

    'library.group': 'Agrupar',
    'library.group.aria': 'Agrupar biblioteca por',
    'library.group.project': 'Projeto',
    'library.group.date': 'Data',
    'library.group.none': 'Nenhum',
    'library.sort': 'Ordenar',
    'library.sort.aria': 'Ordenar biblioteca por',
    'library.sort.newest': 'Recente',
    'library.sort.oldest': 'Antigo',
    'library.sort.title': 'Título',
    'library.tags.aria': 'Filtrar por tag',
    'library.tags.more': '+{n}',
    'library.tags.less': 'Menos',
    'library.project.unknown': 'Outros',
    'library.project.count': '{name} · {n}',
    'library.peek': 'Prévia',

    'shared.count': { one: '{n} compartilhamento', other: '{n} compartilhamentos' },
    'shared.votes': { one: '{n} voto', other: '{n} votos' },
    'shared.loading': 'Carregando…',
    'shared.error.load': 'Não foi possível carregar os compartilhamentos',
    'shared.error.empty': 'Não foi possível carregar os sumários compartilhados.',
    'shared.unconfigured': 'O compartilhamento ainda não está configurado.<br>Adicione um token em <a href="#/sharing">compartilhamento</a>, ou rode <code>lattice login</code>.',
    'shared.none': 'Nada compartilhado ainda.<br>Abra um sumário e use Compartilhar, ou confira as opções de <a href="#/sharing">compartilhamento</a>.',
    'shared.copy': 'Copiar URL',
    'shared.copied': 'Copiado',
    'shared.openPublic': 'Abrir pública',
    'shared.openReader': 'Abrir no leitor',
    'shared.stop': 'Parar de compartilhar',
    'shared.stopping': 'Parando…',

    'share.lede.off': 'Publica um snapshot deste sumário numa URL pública. O dashboard, a API e todos os outros sumários continuam privados.',
    'share.random': 'Subdomínio aleatório',
    'share.publish': 'Compartilhar publicamente',
    'share.publishing': 'Compartilhando…',
    'share.lede.on': 'No ar. Qualquer pessoa com o link pode ver e votar. Só este sumário fica acessível.',
    'share.copy': 'Copiar',
    'share.copied': 'Copiado',
    'share.open': 'Abrir',
    'share.stop': 'Parar de compartilhar',
    'share.stopping': 'Parando…',
    'share.tally': { one: '{n} voto. Consolide com ', other: '{n} votos. Consolide com ' },
    'share.loading': 'Carregando…',

    'form.save': 'Salvar alterações',
    'form.unsaved': 'Alterações não salvas',
    'form.loading': 'Carregando…',
    'form.saving': 'Salvando…',
    'form.saved': 'Alterações salvas',
    'form.error.load': 'Não foi possível carregar a config',
    'form.error.save': 'Não foi possível salvar a config',
    'form.error.accent': 'O destaque precisa ser uma cor hex de seis dígitos',

    'sharing.lede': 'Snapshots públicos vão para o lattice.pub. A biblioteca local funciona sem token — adicione um só quando quiser publicar.',
    'sharing.api.label': 'Endpoint da API',
    'sharing.api.hint': 'Serviço hospedado ou endpoint self-hosted',
    'sharing.token.label': 'Token de acesso',
    'sharing.token.hint': 'Guardado localmente · ou <code>lattice login</code>',
    'sharing.token.placeholder': 'Não configurado',
    'sharing.foot': 'Arquivo de config <code>~/.summaries/.lattice</code>',

    'settings.interface.lede': 'Idioma da interface do dashboard. Aplicado na hora e guardado neste navegador.',
    'settings.language.label': 'Idioma',
    'lang.system': 'Sistema (automático)',
    'lang.pt': 'Português (Brasil)',
    'lang.en': 'English',

    'settings.lede': 'Aparência dos novos sumários HTML gerados pela skill do Lattice. Arquivos existentes nunca são reescritos.',
    'settings.preset.label': 'Preset',
    'settings.preset.default': 'Padrão Lattice',
    'settings.preset.warm': 'Papel quente',
    'settings.preset.mono': 'Mono estrito',
    'settings.tone.label': 'Tom da página',
    'settings.tone.hint': 'Bases mais frias evitam o aspecto amarelado de papel',
    'settings.tone.default': 'Branco Lattice',
    'settings.tone.neutral': 'Neutro',
    'settings.tone.zinc': 'Zinco',
    'settings.tone.mist': 'Névoa',
    'settings.font.label': 'Corpo',
    'settings.font.hint': 'Texto corrido',
    'settings.heading.label': 'Títulos',
    'settings.heading.hint': 'Títulos e números grandes',
    'settings.heading.inherit': 'Igual ao corpo',
    'settings.font.mono': 'Mono',
    'settings.font.sans': 'Sans',
    'settings.font.serif': 'Serif',
    'settings.density.label': 'Densidade',
    'settings.density.compact': 'Compacta',
    'settings.density.comfortable': 'Confortável',
    'settings.density.spacious': 'Espaçosa',
    'settings.dividers.label': 'Divisores',
    'settings.dividers.hint': 'Bordas e separadores',
    'settings.dividers.hairline': 'Fio de cabelo',
    'settings.dividers.soft': 'Suave',
    'settings.dividers.none': 'Nenhum',
    'settings.modules.label': 'Módulos',
    'settings.modules.hint': 'Pares juntos ou separados',
    'settings.modules.mixed': 'Misto',
    'settings.modules.cards': 'Separados (cards)',
    'settings.modules.stacks': 'Juntos (stacks)',
    'settings.accent.label': 'Cor de destaque',
    'settings.accent.hint': 'Cor opcional para links e ênfase',
    'settings.accent.aria': 'Escolher a cor de destaque',
    'settings.accent.hexAria': 'Cor de destaque em hex',
    'settings.accent.clear': 'Limpar',

    'preview.aria': 'Prévia do tema',
    'preview.label': 'Prévia ao vivo',
    'preview.kicker': 'Revisão do sistema / 07',
    'preview.title': 'Sinais que valem guardar.',
    'preview.body': 'Um registro conciso de decisões, evidências e do caminho à frente.',
    'preview.stat1': 'custo atual',
    'preview.stat2': 'já reduzido',
    'preview.stat3': 'alvo',
    'preview.step1': 'Mande tudo de uma vez',
    'preview.step2': 'Feche o diagnóstico',
    'preview.step3': 'Uma fonte de verdade',
    'preview.status': 'Pronto para revisão',
  };

  const DICTS = { en, 'pt-BR': pt };
  const KEY = 'lattice.locale';
  const PREFS = ['system', 'pt-BR', 'en'];

  const detect = () =>
    String(navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';

  const readPref = () => {
    try {
      const v = localStorage.getItem(KEY);
      return PREFS.includes(v) ? v : 'system';
    } catch { return 'system'; }
  };

  let pref = readPref();
  let locale = pref === 'system' ? detect() : pref;
  const listeners = [];

  function t(key, vars) {
    const dict = DICTS[locale] || en;
    let value = key in dict ? dict[key] : en[key];
    if (value == null) return key;
    if (typeof value === 'object') value = vars && vars.n === 1 ? value.one : value.other;
    return String(value).replace(/\{(\w+)\}/g, (m, name) =>
      vars && name in vars ? String(vars[name]) : m);
  }

  // Static markup: data-i18n sets textContent, data-i18n-html sets innerHTML
  // (values are our own literals), and data-i18n-<attr> sets that attribute.
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-html]').forEach((node) => {
      node.innerHTML = t(node.dataset.i18nHtml);
    });
    for (const attr of ATTRS) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((node) => {
        node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
      });
    }
    document.documentElement.lang = locale;
  }

  function setPref(next, { persist = true } = {}) {
    pref = PREFS.includes(next) ? next : 'system';
    locale = pref === 'system' ? detect() : pref;
    if (persist) {
      try {
        if (pref === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch { /* private mode: the choice just won't stick */ }
    }
    apply();
    listeners.forEach((fn) => fn(locale, pref));
  }

  // Keep other open tabs on the same language.
  addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) setPref(readPref(), { persist: false });
  });

  window.LatticeI18n = {
    t,
    apply,
    setPref,
    onChange: (fn) => listeners.push(fn),
    get pref() { return pref; },
    get locale() { return locale; },
  };
})();
