export type Locale = 'en' | 'pt-BR';

const preferenceKey = 'lattice-locale';

const ptBR: Record<string, string> = {
  'Lattice: A local-first library for agent-made reports':
    'Lattice: relatórios de agentes, organizados no seu computador',
  'Keep agent-made HTML reports searchable, share one isolated snapshot, and collect decisions beside the work. Local-first, open source, and MIT licensed.':
    'Tire planos, auditorias e comparativos do chat. O Lattice organiza os arquivos no seu computador, compartilha apenas o que você escolher e mantém cada decisão perto do contexto.',
  'Skip to content': 'Pular para o conteúdo',
  'Lattice home': 'Página inicial do Lattice',
  Main: 'Principal',
  Reports: 'Relatórios',
  Skill: 'Skill',
  Library: 'Biblioteca',
  Download: 'Baixar',
  Downloads: 'Baixar',
  Source: 'Código',
  'A local-first library for agent-made reports':
    'A biblioteca local dos relatórios que seus agentes produzem',
  'Turn agent output into reports your team can use.':
    'Agentes produzem. Sua equipe decide.',
  'Lattice turns standalone HTML into a searchable library. Open the original file, share one isolated report, and collect the decision beside the work.':
    'O Lattice tira relatórios HTML do histórico do chat e reúne tudo em uma biblioteca pesquisável. Você abre, compartilha e coleta respostas sem perder o arquivo original.',
  'Download Lattice': 'Baixar para o meu sistema',
  'Install the report skill': 'Instalar só a skill',
  'One binary · macOS, Linux, Windows · MIT licensed':
    'Um único binário · macOS, Linux e Windows · código aberto',
  'the gap': 'onde o trabalho se perde',
  'Your agent finished the work. The result still got lost.':
    'Um bom relatório não deveria morrer no chat.',
  'Agents can produce careful audits, plans, and comparisons in minutes. The finished artifact still tends to disappear into chat history, a shared folder, or a long Markdown file.':
    'Planos, auditorias e comparativos ficam prontos em minutos. O problema começa depois: o arquivo some na conversa, cai numa pasta sem contexto ou vira um Markdown que ninguém termina de ler.',
  'The problem is not the analysis. It is the handoff from generated output to team review.':
    'A análise já está feita. Falta um caminho claro entre o resultado e a decisão da equipe.',
  'Buried in chat': 'Some na conversa',
  'Useful work becomes one more message in a thread that keeps moving.':
    'Uma resposta bem trabalhada vira só mais uma mensagem numa conversa que não para.',
  'Hard to review': 'Chega sem forma',
  'Markdown can hold the answer, but not always the hierarchy, controls, or context readers need.':
    'O conteúdo existe, mas faltam hierarquia, interação e contexto para orientar a leitura.',
  'Easy to detach': 'A decisão vai para outro lugar',
  'Feedback lands elsewhere, so the recommendation and the decision slowly drift apart.':
    'Comentários e votos ficam espalhados, longe das evidências que deram origem à escolha.',
  'Keep the artifact, the conversation, and the outcome connected.':
    'Um resultado só continua útil quando permanece fácil de encontrar, discutir e lembrar.',
  'the response layer': 'sem mexer no original',
  'Keep the file. Add the workflow.': 'O arquivo fica. O fluxo acontece.',
  'Lattice serves the HTML from disk and adds live reload, isolated sharing, and reader input to the response. Nothing is written back into the source.':
    'O Lattice lê o HTML no disco e acrescenta preview ao vivo, compartilhamento isolado e respostas dos leitores. O arquivo que o agente criou não muda.',
  'Open the raw file anywhere. It stays portable, inspectable HTML.':
    'Feche o Lattice amanhã: o arquivo continua abrindo em qualquer navegador.',
  'Original HTML source file': 'HTML como saiu do agente',
  'Original file': 'No seu disco',
  'API framework review': 'Comparativo de frameworks',
  'Normal HTML': 'HTML puro',
  'Untouched on disk': 'Nenhum byte alterado',
  'Interactive report opened in Lattice': 'O mesmo relatório servido pelo Lattice',
  '← Library': '← Acervo',
  'Report actions': 'Ações disponíveis',
  Share: 'Compartilhar',
  Raw: 'Original',
  'Architecture decision': 'Decisão técnica',
  'Choosing an API framework': 'Qual framework vamos adotar?',
  'Three approaches compared by runtime cost, migration effort, and maintenance.':
    'Custos, esforço de migração e manutenção lado a lado.',
  'Which option should the team take forward?': 'Qual opção merece seguir para o protótipo?',
  'Edge-native path': 'Caminho edge-native',
  'Node standard': 'Padrão Node',
  'Typed runtime': 'Runtime tipado',
  'Blind until you vote': 'Resultado só depois do voto',
  'Submit vote': 'Registrar escolha',
  'Features added when Lattice serves the report':
    'Camada injetada pelo Lattice',
  'Added when Lattice serves': 'O que entra sem tocar no HTML',
  Edit: 'Ao editar',
  'Live reload': 'Atualização automática',
  'Isolated snapshot': 'Um link, um relatório',
  Decide: 'Na decisão',
  'Polls and counts': 'Votos agregados',
  'why HTML': 'HTML é a ponte',
  'Built for browsers. Easy for agents.': 'Um formato. Dois públicos.',
  'For readers': 'Para quem lê',
  'HTML gives a report real hierarchy, responsive layouts, charts, comparisons, and controls. It opens in a browser without a proprietary viewer.':
    'Gráficos, comparações, enquetes e uma hierarquia que deixa a conclusão evidente. Basta abrir o navegador.',
  'For agents': 'Para quem gera',
  'Agents can write, inspect, and revise HTML directly. A self-contained file keeps the content, presentation, and interaction in one portable artifact.':
    'O agente escreve e revisa uma estrutura que já conhece. Conteúdo, visual e interação viajam no mesmo arquivo.',
  'One artifact moves from generation to review without a conversion step.':
    'O mesmo arquivo sai do agente e chega à reunião.',
  'the report skill': 'o padrão de escrita',
  'A report format your agent can reuse.': 'Ensine o formato uma vez.',
  'The html-summary skill gives compatible agents a practical structure for concise, self-contained HTML reports with no external requests.':
    'A skill html-summary mostra ao agente como organizar um relatório claro, autocontido e sem dependências externas.',
  'Use the skill by itself to create portable reports. Add Lattice when you want a library, local preview, sharing, and reader responses around those files.':
    'Ela funciona sozinha. O Lattice entra depois, quando você quiser reunir os arquivos, abrir previews e ouvir quem está lendo.',
  'Inspect the skill': 'Ver como a skill funciona',
  'html-summary · works without Lattice': 'html-summary · independente do Lattice',
  Copy: 'Copiar',
  Copied: 'Copiado',
  Failed: 'Falhou',
  'the local library': 'o acervo no seu computador',
  'From one file to a working record.': 'Organize sem mover um arquivo.',
  'Register a report where it already lives. Lattice makes it quick to retrieve, preview, and share without taking ownership away from the filesystem.':
    'O Lattice registra o caminho, indexa o conteúdo e deixa cada relatório pronto para abrir ou compartilhar. O arquivo continua exatamente onde você colocou.',
  'Index a report in place. Lattice stores its path, not another copy.':
    'Entra no índice sem ser copiado ou movido.',
  'List what is in the library while filesystem events keep the index current.':
    'Mostra o acervo, sempre sincronizado com os arquivos no disco.',
  'Open the local reader and refresh it automatically as the file changes.':
    'Abre o leitor local e acompanha cada alteração em tempo real.',
  'Publish one selected snapshot. The dashboard and every other report stay out of reach.':
    'Gera um link só para o relatório escolhido. O restante do acervo não aparece.',
  'polls · added at serve time': 'respostas · sem alterar o arquivo',
  'Collect a response beside the report and reveal aggregate counts without rewriting the HTML.':
    'Recebe votos junto ao conteúdo e mostra apenas os totais.',
  'The filesystem remains the source of truth. Lattice handles discovery and the response layer around it.':
    'Seus arquivos mandam. O Lattice cuida de encontrar, servir e compartilhar.',
  'the working memory': 'memória de trabalho',
  'Past work stays useful.': 'O que já foi feito continua trabalhando.',
  'Audits, plans, comparisons, and decisions build into a searchable working memory instead of a trail of forgotten links.':
    'Planos, auditorias, comparativos e decisões formam um acervo que a equipe consegue consultar, não um rastro de links esquecidos.',
  'The next question can start with the evidence the team already has.':
    'A próxima discussão começa de onde a anterior terminou.',
  'recent reports': 'últimos relatórios',
  'db · plan · decided': 'banco · plano · decidido',
  'security · 2 polls': 'segurança · 2 decisões',
  'blind vote · decided': 'votação fechada · decidido',
  perf: 'desempenho',
  'finance · voted': 'finanças · votado',
  '+ the next useful artifact': '+ e tudo que vier depois',
  ownership: 'controle de verdade',
  'Local-first. Open source. Yours to run.': 'Seus arquivos. Suas regras.',
  'The CLI, daemon, dashboard, and report skill are MIT licensed. Run them, inspect them, fork them, or ship your own build.':
    'Tudo que roda na sua máquina tem licença MIT: CLI, serviço local, dashboard e skill. Você pode ler, adaptar e distribuir o código.',
  'Local flows bind to your machine, source files stay on disk, and sharing publishes only the report you select.':
    'O serviço fica na sua máquina. Na hora de compartilhar, só o relatório escolhido sai dela.',
  'Browse the repository': 'Ver o código no GitHub',
  'Read the MIT license': 'Conferir a licença MIT',
  'start here': 'primeiro passo',
  'Start with one finished report.': 'Comece com um relatório que já existe.',
  'Install Lattice, add an HTML file, and open your library. If you only want the report format, install the skill on its own.':
    'Instale o Lattice, aponte para um HTML pronto e veja o acervo ganhar forma. Se quiser apenas ensinar o formato ao agente, fique só com a skill.',
  'Choose your download': 'Baixar para este computador',
  'Install only the skill': 'Quero só a skill',
  'Browse the source': 'Abrir o repositório',
  'quick install · macOS (Apple Silicon)': 'instalação rápida · Apple Silicon',
  'Other platforms and SHA-256 checksums are on the':
    'Procurando Windows, Linux, Mac Intel ou checksums? Está tudo na',
  'download page': 'área de downloads',
  'Download the Lattice CLI for macOS, Linux, or Windows, verify its SHA-256 checksum, or install the standalone report skill.':
    'Escolha o binário do seu sistema, confira a integridade do arquivo ou instale somente a skill.',
  download: 'instalação',
  'Run Lattice on your machine.': 'Escolha como rodar o Lattice.',
  'Checking your system…': 'Identificando este computador…',
  "Looks like you're on macOS.": 'Este computador parece ser um Mac.',
  "Looks like you're on Windows.": 'Este computador parece rodar Windows.',
  "Looks like you're on Linux.": 'Este computador parece rodar Linux.',
  "We couldn't detect your system automatically.":
    'Não reconhecemos o sistema. Escolha uma opção abaixo.',
  'CLI, local daemon, and dashboard in one binary · MIT licensed':
    'CLI, serviço local e dashboard no mesmo binário · licença MIT',
  'choose a build': 'escolha o binário',
  'One binary for the local workflow.': 'Baixe uma vez. O resto roda localmente.',
  'Every push to': 'Cada mudança na',
  'publishes five builds to the': 'gera cinco binários na',
  'continuous release': 'release contínua',
  '. Run any Lattice command and the local service starts on demand.':
    '. O primeiro comando inicia o serviço local automaticamente.',
  'macOS default · Apple Silicon': 'recomendado para macOS · Apple Silicon',
  'Using an Intel Mac? Choose': 'Seu Mac tem Intel? Use',
  'below.': 'na lista.',
  'Linux default · x86-64': 'recomendado para Linux · x86-64',
  'Writing to': 'Para gravar em',
  'may require': 'talvez seja necessário usar',
  '. The arm64 build is below.': '. A versão arm64 aparece logo abaixo.',
  'Windows · PowerShell': 'Windows · PowerShell',
  Move: 'Coloque',
  'into a directory on your': 'em uma pasta incluída no',
  'Choose your platform from the builds below.': 'Encontre seu sistema na lista de binários.',
  'matching OS': 'compatível',
  'Rename the download to': 'Depois de baixar, renomeie para',
  'and place it on your': 'e mova para um diretório do',
  '. You are ready.': '. Pronto.',
  'verify the download': 'integridade do arquivo',
  'Check the file before you run it.': 'Confira antes de executar.',
  'Each release includes': 'Os binários vêm acompanhados de',
  'beside the binaries. Download the checksum file from the same release, then run the matching command in the directory that contains your binary.':
    '. Baixe os dois arquivos da mesma release e faça a conferência na pasta onde salvou o Lattice.',
  '# compare with the matching line in SHA256SUMS.txt':
    '# compare com a linha correspondente em SHA256SUMS.txt',
  'On Linux,': 'Se estiver no Linux,',
  'works too.': 'é outra opção.',
  'Want the format without the library?': 'Prefere ficar só com o formato?',
  'Install two files that teach compatible agents to create concise, self-contained HTML reports. The skill works on its own, with no daemon or CLI.':
    'Dois arquivos bastam para o agente produzir relatórios HTML claros e autocontidos. Nenhum serviço precisa ficar rodando.',
  'html-summary · standalone': 'html-summary · use sem instalar o Lattice',
  'build from source': 'compilar localmente',
  'Prefer to compile it yourself?': 'Quer construir o binário na sua máquina?',
  'Lattice is a single Go module. Clone the repository and build the CLI directly.':
    'O projeto é um único módulo Go. Clone o repositório e rode o build, sem ferramenta extra.',
  'requires Go · builds locally': 'requer Go · tudo fica local',
  'Browse every published build on GitHub Releases':
    'Ver todos os binários publicados no GitHub',
  'Page not found: Lattice': 'Lattice: endereço não encontrado',
  'Lattice could not find this page.': 'Este endereço não levou a nenhuma página do Lattice.',
  'This page is not in the library.': 'Esse endereço ficou vazio.',
  'The address may have changed, or the link may be incomplete. Your local reports are unaffected.':
    'Talvez o link esteja incompleto ou a página tenha mudado. Seu acervo local continua exatamente como estava.',
  'Return home': 'Ir para a página inicial',
  'View downloads': 'Abrir downloads',
  'Local-first reports for agent-made work.':
    'Relatórios de agentes, guardados no seu computador.',
  Language: 'Idioma',
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

  const attributes = Array.from(root.querySelectorAll<HTMLElement>('[aria-label], [title]')).flatMap((element) =>
    ['aria-label', 'title']
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
