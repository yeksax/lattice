export type Locale = 'en' | 'pt-BR';

const preferenceKey = 'lattice-locale';

const ptBR: Record<string, string> = {
  // ---- chrome ----
  'Lattice: a local-first library for agent-made reports':
    'Lattice: a biblioteca local dos relatórios que seus agentes escrevem',
  'Your agents write HTML reports. Lattice indexes them where they sit, opens them locally, and keeps every question beside the line it is about. Local-first, open source, MIT licensed.':
    'Seus agentes escrevem relatórios em HTML. O Lattice indexa cada arquivo onde ele já está, abre tudo localmente e mantém cada pergunta ao lado da linha que a provocou. Local, aberto e com licença MIT.',
  'Skip to content': 'Pular para o conteúdo',
  'Lattice home': 'Página inicial do Lattice',
  Main: 'Principal',
  'How it works': 'Como funciona',
  'The margin': 'A margem',
  Skill: 'Skill',
  Download: 'Baixar',
  'Report skill': 'Skill de relatórios',
  Source: 'Código',
  'MIT license': 'Licença MIT',
  Language: 'Idioma',
  'A local-first library for the reports your agents write.':
    'A biblioteca local dos relatórios que seus agentes escrevem.',

  // ---- hero ----
  'Agents write the report. Your team writes in the margin.':
    'Agentes escrevem o relatório. Seu time escreve na margem.',
  'Lattice indexes those files where they sit, serves them locally, and keeps every question beside the line it is about.':
    'O Lattice indexa esses arquivos onde eles já estão, serve tudo localmente e mantém cada pergunta ao lado da linha que a provocou.',
  'Download Lattice': 'Baixar o Lattice',
  'Install the report skill': 'Instalar só a skill',
  'where it goes': 'onde o trabalho some',
  'The analysis was never the problem.': 'A análise nunca foi o problema.',
  'The file lands in a chat thread. The questions land somewhere else. The decision gets made in a third place, and six weeks later nobody can find any of the three.':
    'O arquivo cai numa conversa. As perguntas aparecem em outro lugar. A decisão acontece num terceiro, e seis semanas depois ninguém encontra nenhum dos três.',
  'In chat, it scrolls away.': 'No chat, ele sobe e some.',
  'In Markdown, it flattens.': 'Em Markdown, ele achata.',
  'In a folder, it goes quiet.': 'Numa pasta, ele silencia.',

  // ---- three moves ----
  'how it works': 'como funciona',
  'Three moves, and the file never changes.': 'Três passos, e o arquivo nunca muda.',
  'Your agent writes one file.': 'Seu agente escreve um arquivo.',
  'Self-contained HTML with real hierarchy: tables, charts, polls, controls, and no external requests. The html-summary skill gives your agent a shape to follow.':
    'HTML autocontido, com hierarquia de verdade: tabelas, gráficos, enquetes, controles e nenhuma requisição externa. A skill html-summary dá ao agente uma forma para seguir.',
  'Lattice indexes it where it is.': 'O Lattice indexa onde ele está.',
  'Adding a report records its path, never a copy. The library stays searchable, and filesystem events keep it current while you work on the file in your editor.':
    'Registrar um relatório guarda o caminho dele, nunca uma cópia. A biblioteca continua pesquisável, e os eventos do sistema de arquivos a mantêm em dia enquanto você edita.',
  'One report goes out. Not the library.': 'Sai um relatório. Não a biblioteca.',
  'Publishing uploads a snapshot of the report you name, and it stays online with your laptop closed. Restrict it to your company domain and readers sign in with Google. Everyone else gets a 403.':
    'Publicar envia um snapshot do relatório que você escolher, e ele fica no ar com o notebook fechado. Restrinja ao domínio da empresa e quem for ler entra com a conta Google. Todo o resto recebe um 403.',
  'the response layer': 'a camada de resposta',
  'What the margin adds.': 'O que a margem acrescenta.',
  'Served through Lattice, a static file gains everything a document needs to be argued with, and gives none of it back to the source.':
    'Servido pelo Lattice, um arquivo estático ganha tudo o que um documento precisa para ser discutido, e não devolve nada disso ao original.',
  'Threads anchored to a line': 'Conversas presas à linha',
  'Comment on the exact row people argue about. The thread survives the next version of the file, and it can be resolved or reopened later.':
    'Comente exatamente na linha em disputa. A conversa sobrevive à próxima versão do arquivo e pode ser resolvida ou reaberta depois.',
  'Replies from the terminal': 'Respostas pelo terminal',
  'lattice threads prints the discussion and lattice reply answers it, so the agent that wrote the report can defend it.':
    'O lattice threads imprime a discussão e o lattice reply responde, então o agente que escreveu o relatório consegue defendê-lo.',
  'Decisions that persist': 'Decisões que ficam salvas',
  'Ticked boxes, notes, and open sections remember themselves, shared with the team or private to one reader.':
    'Caixas marcadas, anotações e seções abertas se lembram sozinhas, compartilhadas com o time ou privadas de quem leu.',
  'Blind polls': 'Votação fechada',
  'Collect a vote beside the evidence. Nothing is revealed until the last reader has answered.':
    'Receba o voto ao lado da evidência. Nada aparece até o último leitor responder.',
  'Live reload, an outline, and shortcuts': 'Preview ao vivo, índice e atalhos',
  'Save the file and every open reader repaints. A rail indexes the sections and marks where the discussion is. C starts a comment, shift S shares, shift D downloads.':
    'Salvou o arquivo, todo leitor aberto se redesenha. Uma trilha lateral indexa as seções e marca onde está a discussão. C começa um comentário, shift S compartilha, shift D baixa.',
  'Nothing is written back into the source. Close Lattice and the report is still plain HTML that opens anywhere.':
    'Nada disso é gravado no arquivo original. Feche o Lattice e o relatório continua sendo HTML simples, que abre em qualquer lugar.',
  'Nothing is written back into the source.': 'Nada disso é gravado no arquivo original.',
  'Close Lattice and the report is still plain HTML that opens anywhere.':
    'Feche o Lattice e o relatório continua sendo HTML simples, que abre em qualquer lugar.',

  // ---- reader miniatures in the margin panels ----
  // The terminal transcript stays in English: a command and its output are
  // quoted literally, and a translated one would not run.
  'Monthly bill': 'Conta do mês',
  'Object storage': 'Armazenamento de objetos',
  'Image CDN': 'CDN de imagens',
  'Managed Postgres': 'Postgres gerenciado',
  'Open the thread on this line': 'Abrir a conversa desta linha',
  'Resolve this thread': 'Resolver esta conversa',
  'Triple last month.': 'O triplo do mês passado.',
  'Nobody resized the hero images.': 'Ninguém redimensionou as imagens de capa.',
  Run: 'Rodar',
  Running: 'Rodando',
  'Run again': 'Rodar de novo',
  'What we are cutting': 'O que vamos cortar',
  'Resize images on upload': 'Redimensionar as imagens no upload',
  'Drop the staging replica': 'Derrubar a réplica de staging',
  'Archive the 2023 exports': 'Arquivar os exports de 2023',
  agreed: 'acordados',
  'Reopen the file': 'Reabrir o arquivo',
  'Drop the staging replica?': 'Derrubar a réplica de staging?',
  'Keep it': 'Manter',
  'Drop it and watch': 'Derrubar e observar',
  'Ask the data team': 'Perguntar ao time de dados',
  'of 4 answered': 'de 4 responderam',
  'Click to vote': 'Clique para votar',
  'Click again to change your vote': 'Clique de novo para mudar o voto',
  'Tap to vote': 'Toque para votar',
  'Tap again to change your vote': 'Toque de novo para mudar o voto',
  'open · costs': 'aberta · costs',
  'resolved · costs': 'resolvida · costs',
  'Close the thread': 'Fechar a conversa',
  'Reply in this thread': 'Responder nesta conversa',
  'Start a new thread on this line': 'Começar uma conversa nesta linha',
  'Start a new thread': 'Começar uma conversa',
  Send: 'Enviar',
  You: 'Você',
  now: 'agora',
  Outline: 'Índice',
  Summary: 'Resumo',
  'Three savings, nothing a reader would notice.':
    'Três economias, nada que o leitor perceba.',
  'The image CDN came to $1,240, triple last month.':
    'A CDN de imagens deu $1.240, o triplo do mês passado.',
  'Resize on upload, drop the staging replica.':
    'Redimensionar no upload, derrubar a réplica de staging.',
  'Ship the three this week.': 'Aplicar os três esta semana.',
  'Nothing user-facing. Confirmed.': 'Nada que o usuário veja. Confirmado.',
  'Add a reaction': 'Adicionar uma reação',
  Costs: 'Custos',
  Cuts: 'Cortes',
  Decision: 'Decisão',
  'Monthly run rate': 'Custo mensal',
  Comment: 'Comentar',
  Share: 'Compartilhar',
  'Save the file': 'Salvar o arquivo',

  // ---- why HTML ----
  'why HTML': 'por que HTML',
  'One file goes from the agent to the meeting without a conversion step.':
    'Um arquivo sai do agente e chega à reunião sem etapa de conversão.',
  'For readers': 'Para quem lê',
  'A report gets real hierarchy: comparisons, charts, controls, and a conclusion you can find in five seconds. It opens in a browser, with no viewer to install.':
    'O relatório ganha hierarquia de verdade: comparações, gráficos, controles e uma conclusão que se acha em cinco segundos. Abre no navegador, sem instalar leitor nenhum.',
  'For agents': 'Para quem gera',
  'HTML is a format agents already write, inspect, and revise. One self-contained file carries the content, the presentation, and the interaction together.':
    'HTML é um formato que os agentes já escrevem, inspecionam e revisam. Um único arquivo carrega conteúdo, apresentação e interação juntos.',

  // ---- the record ----
  'the working memory': 'memória de trabalho',
  'Past work keeps working.': 'O que já foi feito continua servindo.',
  'Audits, plans, and comparisons stack up into something the team can search, instead of a trail of links nobody clicks twice. The next question starts from what you already know.':
    'Auditorias, planos e comparativos se acumulam em algo que o time consegue pesquisar, em vez de um rastro de links que ninguém abre duas vezes. A próxima pergunta começa do que você já sabe.',

  // ---- the skill ----
  'works on its own': 'funciona sozinha',
  'The format, without the library.': 'O formato, sem a biblioteca.',
  'html-summary is the skill that teaches a compatible agent how a summary should be built: dense, self-contained, no external requests. Install it on its own and keep the files wherever you like. Add Lattice when you want the library and the margin around them.':
    'html-summary é a skill que ensina um agente compatível a montar um sumário: denso, autocontido e sem requisições externas. Instale só ela e guarde os arquivos onde quiser. O Lattice entra depois, quando você quiser a biblioteca e a margem em volta\u00A0deles.',
  'No daemon, no CLI, no configuration. The skill is MIT licensed too.':
    'Sem serviço rodando, sem CLI, sem configuração. A\u00A0skill também é MIT.',
  'Inspect the skill': 'Ver como a skill funciona',
  Copy: 'Copiar',
  Copied: 'Copiado',
  Failed: 'Falhou',

  // ---- start ----
  'start here': 'primeiro passo',
  'Start with one report you already have.': 'Comece com um relatório que já existe.',
  'Install the binary, point it at a finished HTML file, and open your library. The CLI, the daemon, the dashboard, and the skill are MIT licensed: run them, read them, fork them.':
    'Instale o binário, aponte para um HTML pronto e abra sua biblioteca. A CLI, o serviço local, o dashboard e a skill têm licença MIT: rode, leia e modifique à vontade.',
  'Read the source': 'Ler o código',
  'One binary. macOS, Linux, and Windows.': 'Um único binário. macOS, Linux e Windows.',

  // ---- download page ----
  'Download Lattice for macOS, Linux, or Windows': 'Baixe o Lattice para macOS, Linux ou Windows',
  'Download the Lattice CLI for macOS, Linux, or Windows, verify its SHA-256 checksum, or install the standalone report skill.':
    'Baixe a CLI do Lattice para macOS, Linux ou Windows, confira o checksum SHA-256 ou instale apenas a skill de relatórios.',
  'CLI, local daemon, and dashboard in one binary. MIT licensed.':
    'CLI, serviço local e dashboard no mesmo binário. Licença MIT.',
  'Run Lattice on your machine.': 'Rode o Lattice na sua máquina.',
  'Checking your system…': 'Identificando este computador…',
  "Looks like you're on macOS.": 'Este computador parece ser um Mac.',
  "Looks like you're on Windows.": 'Este computador parece rodar Windows.',
  "Looks like you're on Linux.": 'Este computador parece rodar Linux.',
  "We couldn't detect your system automatically.":
    'Não reconhecemos o sistema. Escolha uma opção abaixo.',
  'choose a build': 'escolha o binário',
  'One binary for the local workflow.': 'Um binário para todo o fluxo local.',
  'Every push to': 'Cada mudança na',
  'publishes five builds to the': 'gera cinco binários na',
  'continuous release': 'release contínua',
  '. Run any Lattice command and the local service starts on demand.':
    '. O primeiro comando do Lattice já sobe o serviço local.',
  'macOS default, Apple Silicon': 'padrão do macOS, Apple Silicon',
  'Using an Intel Mac? Choose': 'Seu Mac tem Intel? Use',
  'below.': 'na lista abaixo.',
  'Linux default, x86-64': 'padrão do Linux, x86-64',
  'Writing to': 'Para gravar em',
  'may require': 'talvez seja necessário usar',
  '. The arm64 build is below.': '. A versão arm64 aparece logo abaixo.',
  'Windows, PowerShell': 'Windows, PowerShell',
  Move: 'Coloque',
  'into a directory on your': 'em uma pasta incluída no',
  'Choose your platform from the builds below.': 'Encontre seu sistema na lista de binários.',
  'matching OS': 'compatível',
  'Rename the download to': 'Depois de baixar, renomeie para',
  'and place it on your': 'e mova para um diretório do',
  '. You are ready.': '. Pronto.',
  'macOS, Apple Silicon': 'macOS, Apple Silicon',
  'macOS, Intel': 'macOS, Intel',
  'Linux, arm64': 'Linux, arm64',
  'Linux, x86-64': 'Linux, x86-64',
  'Windows, x86-64': 'Windows, x86-64',
  'verify the download': 'confira o arquivo',
  'Check the file before you run it.': 'Confira o arquivo antes de executar.',
  'Each release includes': 'Cada release traz um',
  'beside the binaries. Download the checksum file from the same release, then run the matching command in the directory that contains your binary.':
    'junto dos binários. Baixe esse arquivo da mesma release e rode o comando correspondente na pasta onde salvou o Lattice.',
  'macOS and Linux': 'macOS e Linux',
  '# compare with the matching line in SHA256SUMS.txt':
    '# compare com a linha correspondente em SHA256SUMS.txt',
  'On Linux,': 'No Linux,',
  'works too.': 'também funciona.',
  'Want the format without the library?': 'Quer o formato sem a biblioteca?',
  'One command installs the skill that teaches a compatible agent to write concise, self-contained HTML reports. No daemon, no CLI, no configuration.':
    'Um comando instala a skill que ensina um agente compatível a escrever relatórios HTML enxutos e autocontidos. Sem serviço rodando, sem CLI, sem configuração.',
  'html-summary, standalone': 'html-summary, sozinha',
  'build from source': 'compilar do código',
  'Prefer to compile it yourself?': 'Prefere compilar você mesmo?',
  'Lattice is a single Go module. Clone the repository and build the CLI directly.':
    'O Lattice é um único módulo Go. Clone o repositório e compile a CLI direto.',
  'requires Go, builds locally': 'requer Go, compila localmente',
  'Browse every published build on GitHub Releases':
    'Ver todos os binários publicados no GitHub',

  // ---- 404 ----
  'Page not found: Lattice': 'Lattice: endereço não encontrado',
  'Lattice could not find this page.': 'Este endereço não levou a nenhuma página do Lattice.',
  'This page is not in the library.': 'Esta página não está na biblioteca.',
  'The address may have changed, or the link may be incomplete. Your local reports are unaffected.':
    'Talvez o link esteja incompleto ou a página tenha mudado. Seus relatórios locais continuam exatamente como estavam.',
  'Return home': 'Ir para a página inicial',
  'View downloads': 'Abrir downloads',
};

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function detectLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(preferenceKey);
    if (saved === 'en' || saved === 'pt-BR') return saved;
  } catch {
    // Storage can be unavailable in privacy-focused browsing modes.
  }

  const browserLanguages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return browserLanguages.some((language) => language.toLowerCase().startsWith('pt')) ? 'pt-BR' : 'en';
}

export function getCurrentLocale(): Locale {
  return document.documentElement.lang === 'pt-BR' ? 'pt-BR' : 'en';
}

export function translateLabel(label: string, locale = getCurrentLocale()): string {
  return locale === 'pt-BR' ? (ptBR[label] ?? label) : label;
}

export function initLocale(): void {
  const root = document.querySelector<HTMLElement>('[data-localized-page]');
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Array<{ node: Text; source: string }> = [];
  let current = walker.nextNode();
  while (current) {
    const source = current.textContent ?? '';
    if (normalize(source)) textNodes.push({ node: current as Text, source });
    current = walker.nextNode();
  }

  const attributes = Array.from(root.querySelectorAll<HTMLElement>('[aria-label], [title], [alt]')).flatMap(
    (element) =>
      ['aria-label', 'title', 'alt']
        .map((name) => ({ element, name, source: element.getAttribute(name) }))
        .filter((item): item is { element: HTMLElement; name: string; source: string } => item.source !== null),
  );
  const sourceTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const sourceDescription = description?.content ?? '';

  const render = (locale: Locale): void => {
    document.documentElement.lang = locale;
    document.title = translateLabel(sourceTitle, locale);
    if (description) description.content = translateLabel(sourceDescription, locale);

    for (const { node, source } of textNodes) {
      const key = normalize(source);
      const translation = translateLabel(key, locale);
      if (translation === key) {
        node.textContent = source;
        continue;
      }
      const leading = source.match(/^\s*/)?.[0] ?? '';
      const trailing = source.match(/\s*$/)?.[0] ?? '';
      node.textContent = `${leading}${translation}${trailing}`;
    }

    for (const { element, name, source } of attributes) {
      element.setAttribute(name, translateLabel(source, locale));
    }

    document.querySelectorAll<HTMLButtonElement>('[data-locale-option]').forEach((button) => {
      button.setAttribute('aria-current', String(button.dataset.localeOption === locale));
    });
  };

  document.querySelectorAll<HTMLButtonElement>('[data-locale-option]').forEach((button) => {
    button.addEventListener('click', () => {
      const locale = button.dataset.localeOption as Locale;
      try {
        window.localStorage.setItem(preferenceKey, locale);
      } catch {
        // The selection still applies for the current page view.
      }
      render(locale);
    });
  });

  render(detectLocale());
}
