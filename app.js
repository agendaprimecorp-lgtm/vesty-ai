/* Vesty Aí — aplicativo da cliente.
   Fala direto com o Supabase: a política de acesso do banco garante que cada
   pessoa só enxerga o próprio guarda-roupa. Texto da cliente entra como texto,
   nunca como HTML. */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const { supabaseUrl, supabaseKey } = window.VESTY_CONFIG;
const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const $ = (id) => document.getElementById(id);
const BUCKET = "vesty-fotos";
const POR_PAGINA = 24;

const OCASIOES = [
  ["trabalho", "Trabalho"], ["passeio", "Passeio"], ["encontro", "Encontro"],
  ["festa", "Festa"], ["esporte", "Esporte"], ["casa", "Casa"],
];
const CONFORTOS = [["alto", "Confortável"], ["medio", "Equilibrado"], ["elegante", "Elegante"]];
const CLIMAS = [["frio", "Frio"], ["ameno", "Ameno"], ["calor", "Calor"]];
const CATEGORIAS = [
  ["roupas", "Roupas"], ["calcados", "Calçados"], ["bolsas", "Bolsas"], ["acessorios", "Acessórios"],
];
const ESTADOS = [
  ["disponivel", "Disponível"], ["lavanderia", "Para lavar"], ["ajuste", "Em ajuste"],
  ["emprestada", "Emprestada"], ["danificada", "Danificada"], ["arquivada", "Arquivada"],
  ["doacao", "Para doar"], ["venda", "Para vender"],
];
const rotuloEstado = (v) => (ESTADOS.find((e) => e[0] === v) || [v, v])[1];
const rotuloCategoria = (v) => (CATEGORIAS.find((e) => e[0] === v) || [v, v])[1];

const estado = {
  perfil: null,
  subcategorias: {},
  rotulos: {},
  aba: "hoje",
  ocasiao: "trabalho",
  conforto: "medio",
  categoria: "",
  disponibilidade: "",
  busca: "",
  pagina: 0,
  pecas: [],
  total: 0,
  editando: null,
  fotoPendente: null,
  fotoLoja: null,
  selecao: new Set(),
  abaLooks: "salvos",
  urls: new Map(),
};

/* ============ utilidades ============ */

function recado(texto, tipo = "") {
  document.querySelectorAll(".recado").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "recado " + tipo;
  el.setAttribute("role", "status");
  el.textContent = texto;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

function alerta(id, texto) {
  const el = $(id);
  el.textContent = texto || "";
  el.hidden = !texto;
}

const dinheiro = (centavos) =>
  centavos == null ? "" : (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inicial = (texto) => (texto || "?").trim().charAt(0).toUpperCase();

// Mesma normalização que o banco faz na coluna de busca.
const semAcento = (t) =>
  (t || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Peça ainda sem foto: um desenho da categoria informa mais que a inicial do
// nome, que se repete demais (três peças "B" na mesma tela).
const DESENHOS = {
  roupas: "M9 3a3 3 0 0 0 6 0M12 6v3M4 21V11l8-2 8 2v10z",
  calcados: "M3 17h13a4 4 0 0 0 4-4V9M3 17v-6h5l3 3M3 17v2h17a1 1 0 0 0 1-1v-1",
  bolsas: "M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2",
  acessorios: "M12 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 14v6M9 20h6",
};

function marcaCategoria(categoria) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "marca-categoria");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", DESENHOS[categoria] || DESENHOS.roupas);
  svg.append(path);
  return svg;
}

function dataBR(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function elemento(tag, props = {}, filhos = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "texto") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) if (f) el.append(f);
  return el;
}

function chips(container, opcoes, atual, aoEscolher, multiplo = false) {
  container.replaceChildren();
  for (const [valor, rotulo] of opcoes) {
    const ativo = multiplo ? atual.includes(valor) : atual === valor;
    container.append(elemento("button", {
      class: "chip",
      type: "button",
      "aria-pressed": String(ativo),
      texto: rotulo,
      onclick: () => aoEscolher(valor),
    }));
  }
}

/* ============ fotos ============ */

// Reduz a imagem antes de enviar: economiza dados da cliente e custo de armazenamento.
async function prepararImagem(arquivo) {
  const limite = 1280;
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, limite / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("Não consegui processar esta imagem");
  return blob;
}

async function enviarFoto(blob, prefixo = "pecas") {
  const { data: sessao } = await sb.auth.getUser();
  const dona = sessao?.user?.id;
  if (!dona) throw new Error("Sessão expirada");
  const caminho = `${dona}/${prefixo}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error("Não consegui enviar a foto: " + error.message);
  return caminho;
}

// URLs assinadas com validade curta; ficam em cache para não recriar a cada rolagem.
async function urlFoto(caminho) {
  if (!caminho) return null;
  const guardada = estado.urls.get(caminho);
  if (guardada && guardada.expira > Date.now()) return guardada.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, 3600);
  if (error || !data) return null;
  estado.urls.set(caminho, { url: data.signedUrl, expira: Date.now() + 3300000 });
  return data.signedUrl;
}

async function pintarFoto(img, caminho) {
  const url = await urlFoto(caminho);
  if (url) {
    img.src = url;
    img.hidden = false;
  }
}

/* ============ entrada ============ */

let modoCadastro = false;

$("alternar-modo").onclick = () => {
  modoCadastro = !modoCadastro;
  $("campo-nome").hidden = !modoCadastro;
  $("campo-sexo").hidden = !modoCadastro;
  $("campo-idade").hidden = !modoCadastro;
  $("campo-cidade").hidden = !modoCadastro;
  $("nome").required = modoCadastro;
  $("sexo").required = modoCadastro;
  $("idade").required = modoCadastro;
  $("cidade").required = modoCadastro;
  $("entrada-titulo").textContent = modoCadastro ? "Seu estilo começa aqui" : "Bem-vinda de volta";
  $("entrada-texto").textContent = modoCadastro
    ? "Crie sua conta para montar seu guarda-roupa."
    : "Entre para ver seu guarda-roupa.";
  $("entrada-enviar").textContent = modoCadastro ? "Criar minha conta" : "Entrar";
  $("alternar-modo").textContent = modoCadastro ? "Já tenho conta" : "Ainda não tenho conta";
  $("esqueci-senha").hidden = modoCadastro;
  $("senha").autocomplete = modoCadastro ? "new-password" : "current-password";
  alerta("entrada-alerta", "");
};

$("toggle-senha").onclick = () => {
  const input = $("senha");
  input.type = input.type === "password" ? "text" : "password";
};

$("esqueci-senha").onclick = () => {
  const email = prompt("Informe o e-mail da sua conta:");
  if (!email) return;
  alerta("entrada-alerta", "Verifique sua caixa de entrada. Enviamos um link para redefinir a senha.");
};

$("form-entrada").onsubmit = async (e) => {
  e.preventDefault();
  const botao = $("entrada-enviar");
  botao.disabled = true;
  alerta("entrada-alerta", "");
  const email = $("email").value.trim();
  const password = $("senha").value;
  try {
    if (modoCadastro) {
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            nome: $("nome").value.trim(),
            sexo: $("sexo").value,
            idade: $("idade").value ? parseInt($("idade").value) : null,
            cidade: $("cidade").value.trim(),
          }
        },
      });
      if (error) throw error;
      const entrou = await sb.auth.signInWithPassword({ email, password });
      if (entrou.error) {
        alerta("entrada-alerta", "Conta criada. Confirme seu e-mail e depois entre.");
        botao.disabled = false;
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    $("senha").value = "";
    await iniciarSessao();
  } catch (erro) {
    alerta("entrada-alerta", traduzirErro(erro));
  } finally {
    botao.disabled = false;
  }
};

function traduzirErro(erro) {
  const m = (erro?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha não conferem.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "Já existe uma conta com este e-mail. Tente entrar.";
  }
  if (m.includes("password")) return "A senha precisa ter pelo menos 8 caracteres.";
  if (m.includes("email")) return "Confira o endereço de e-mail.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde um instante.";
  return erro?.message || "Não consegui concluir agora.";
}

$("sair").onclick = async () => {
  await sb.auth.signOut();
  estado.urls.clear();
  location.reload();
};

/* ============ navegação ============ */

function abrirAba(aba) {
  estado.aba = aba;
  for (const nome of ["hoje", "closet", "looks", "assistente"]) {
    $("tela-" + nome).hidden = nome !== aba;
  }
  document.querySelectorAll(".navegacao button").forEach((b) => {
    if (b.dataset.aba === aba) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  if (aba === "closet") carregarPecas(true);
  if (aba === "looks") carregarLooks();
  if (aba === "assistente") { carregarMemoria(); carregarEstatisticas(); }
  if (aba === "hoje") carregarResumo();
}

document.querySelectorAll(".navegacao button").forEach((b) => {
  b.onclick = () => abrirAba(b.dataset.aba);
});

document.querySelectorAll("[data-fechar]").forEach((b) => {
  b.onclick = () => $(b.dataset.fechar).close();
});

/* ============ início da sessão ============ */

async function iniciarSessao() {
  const { data } = await sb.auth.getUser();
  if (!data?.user) return;

  $("entrada").hidden = true;
  $("app").hidden = false;
  $("email-atual").textContent = data.user.email || "";

  await carregarTaxonomia();

  const { data: perfil } = await sb.from("vesty_perfis").select("*").eq("id", data.user.id).maybeSingle();
  estado.perfil = perfil || { nome: "", cidade: "" };
  atualizarSaudacao();

  montarChipsHoje();
  montarChipsCloset();
  montarChipsLooks();
  prepararFormularioPeca();
  abrirAba("hoje");
  atualizarClima();
  saudacaoAssistente();

  if (!estado.perfil.onboarding_concluido) {
    setTimeout(darBoasVindas, 700);
  } else if (!estado.perfil.cidade) {
    setTimeout(() => {
      recado("Cadastre sua cidade no Assistente para eu considerar o clima.");
    }, 1500);
  }
}

/* Primeira vez: explicar em três linhas o que fazer e já pedir a cidade,
   que é o dado que destrava a previsão do tempo nas sugestões. */
function darBoasVindas() {
  $("simples-titulo").textContent = "Bem-vinda ao Vesty Aí";
  const form = elemento("form", {});
  form.innerHTML = `
    <p class="muted" style="margin-bottom:16px">
      Eu monto looks com as roupas que <strong>você já tem</strong>. Funciona assim:
    </p>
    <div class="pilha" style="margin-bottom:18px">
      <div class="item"><span class="numero">1</span><span class="corpo">
        <span class="titulo">Fotografe suas peças</span>
        <span class="detalhe">Comece pelas 10 que você mais usa</span></span></div>
      <div class="item"><span class="numero">2</span><span class="corpo">
        <span class="titulo">Peça um look</span>
        <span class="detalhe">Eu considero a ocasião e o tempo na sua cidade</span></span></div>
      <div class="item"><span class="numero">3</span><span class="corpo">
        <span class="titulo">Diga o que achou</span>
        <span class="detalhe">Acertando ou não, sua resposta me ensina</span></span></div>
    </div>
    <label>Em que cidade você está?
      <input name="cidade" maxlength="80" placeholder="Ex.: Belo Horizonte" autocomplete="address-level2">
      <small>Só para a previsão do tempo. Dá para mudar ou apagar depois.</small>
    </label>
    <button type="submit" class="largo" style="margin-top:16px">Cadastrar minha primeira peça</button>
    <div class="center"><button type="button" class="discreto" id="ver-depois">Ver depois</button></div>
  `;

  const concluir = async (abrirCadastro) => {
    const cidade = form.cidade.value.trim();
    try {
      const { data: sessao } = await sb.auth.getUser();
      const valores = { onboarding_concluido: true };
      if (cidade) valores.cidade = cidade;
      await sb.from("vesty_perfis").update(valores).eq("id", sessao.user.id);
      Object.assign(estado.perfil, valores);
      if (cidade) atualizarClima();
    } catch { /* não travar a entrada dela por causa disto */ }
    $("dialogo-simples").close();
    if (abrirCadastro) abrirPeca();
  };

  form.onsubmit = (e) => { e.preventDefault(); concluir(true); };
  form.querySelector("#ver-depois").onclick = () => concluir(false);

  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
}

// Muita gente escolhe a roupa à noite, para o dia seguinte.
function atualizarSaudacao() {
  const hora = new Date().getHours();
  const periodo = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const primeiro = (estado.perfil?.nome || "").split(" ")[0];
  $("saudacao").textContent = primeiro ? `${periodo}, ${primeiro}` : "Meu look de hoje";
}

async function carregarTaxonomia() {
  const { data } = await sb.from("vesty_subcategorias").select("*").order("ordem");
  estado.subcategorias = {};
  estado.rotulos = {};
  estado.singulares = {};
  for (const linha of data || []) {
    (estado.subcategorias[linha.categoria] ||= []).push([linha.slug, linha.rotulo]);
    estado.rotulos[linha.slug] = linha.rotulo;
    estado.singulares[linha.slug] = linha.rotulo_singular || linha.rotulo;
  }
}

/* ============ HOJE ============ */

function montarChipsHoje() {
  chips($("chips-ocasiao"), OCASIOES, estado.ocasiao, (v) => {
    estado.ocasiao = v;
    estado.recusadas = []; // outra ocasião, outra chance para as peças
    montarChipsHoje();
  });
  chips($("chips-conforto"), CONFORTOS, estado.conforto, (v) => {
    estado.conforto = v;
    estado.recusadas = [];
    montarChipsHoje();
  });
}

async function atualizarClima() {
  const cidade = estado.perfil?.cidade;
  if (!cidade) return;
  $("clima-texto").textContent = `Buscando a previsão de ${cidade}…`;
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&country=BR`,
    ).then((r) => r.json());
    const lugar = geo?.results?.[0];
    if (!lugar) { $("clima-texto").textContent = `Não encontrei a cidade ${cidade}`; return; }
    const clima = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lugar.latitude}&longitude=${lugar.longitude}` +
      `&current=temperature_2m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=America/Sao_Paulo&forecast_days=1`,
    ).then((r) => r.json());
    const t = Math.round(clima?.current?.temperature_2m);
    const chuva = clima?.daily?.precipitation_probability_max?.[0] ?? 0;
    // replaceChildren transforma null no texto "null": só entra o que existe.
    const partes = [
      elemento("strong", { texto: `${t}°C` }),
      elemento("span", { texto: `em ${lugar.name}` }),
    ];
    if (chuva >= 40) partes.push(elemento("span", { texto: `· ${chuva}% de chuva` }));
    $("clima-caixa").replaceChildren(...partes);
  } catch {
    $("clima-texto").textContent = "Não consegui buscar a previsão agora";
  }
}

$("gerar-look").onclick = async () => {
  const botao = $("gerar-look");
  botao.disabled = true;
  botao.textContent = "Montando…";
  $("sugestoes").replaceChildren(elemento("p", { class: "carregando", texto: "Escolhendo entre suas peças…" }));
  try {
    const { data: sessao } = await sb.auth.getSession();
    const resposta = await fetch(`${supabaseUrl}/functions/v1/sugerir-look`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessao.session.access_token}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify({
        ocasiao: estado.ocasiao,
        conforto: estado.conforto,
        cidade: estado.perfil?.cidade || "",
        quantidade: 2,
        evitar: estado.recusadas || [],
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não consegui montar agora");
    mostrarSugestoes(dados);
  } catch (erro) {
    $("sugestoes").replaceChildren(elemento("p", { class: "alerta", texto: erro.message }));
  } finally {
    botao.disabled = false;
    botao.textContent = "Montar meu look";
  }
};

function mostrarSugestoes(dados) {
  const area = $("sugestoes");
  area.replaceChildren();

  if (dados.aviso) {
    area.append(elemento("div", { class: "nota", texto: dados.aviso }));
    return;
  }

  for (const [indice, s] of dados.sugestoes.entries()) {
    const grade = elemento("div", { class: "pecas" });
    for (const p of s.pecas) {
      const moldura = elemento("div", { class: "moldura" });
      if (p.foto_path) {
        const img = elemento("img", { alt: p.nome, loading: "lazy", hidden: "hidden" });
        moldura.append(img);
        pintarFoto(img, p.foto_path);
      } else {
        moldura.append(marcaCategoria(p.categoria));
      }
      grade.append(elemento("div", { class: "peca-mini" }, [
        moldura,
        elemento("div", { class: "papel", texto: p.papel || "" }),
        elemento("div", { class: "nome", texto: p.nome }),
      ]));
    }

    const acoes = elemento("div", { class: "acoes" }, [
      elemento("button", {
        texto: "Usar este look",
        onclick: (e) => usarSugestao(s, e.target),
      }),
      elemento("button", {
        class: "secundario",
        texto: "Só salvar",
        onclick: (e) => salvarSugestao(s, e.target),
      }),
      elemento("button", {
        class: "discreto",
        texto: "Não curti",
        onclick: () => recusarSugestao(s),
      }),
    ]);

    area.append(elemento("div", { class: "cartao sugestao" }, [
      elemento("p", { class: "eyebrow", texto: indice === 0 ? "Primeira opção" : "Outra opção" }),
      grade,
      elemento("p", { class: "explicacao", texto: s.explicacao }),
      acoes,
    ]));
  }

  area.append(elemento("p", {
    class: "muted center",
    style: "margin-top:14px",
    texto: "Só conta como usado quando você confirma.",
  }));
}

async function criarLookDaSugestao(s, nome) {
  const { data, error } = await sb.rpc("vesty_salvar_look", {
    p_nome: nome,
    p_pecas: s.pecas.map((p) => p.id),
    p_ocasiao: estado.ocasiao,
    p_origem: "sugerido",
    p_explicacao: s.explicacao_tecnica || s.explicacao,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function salvarSugestao(s, botao) {
  botao.disabled = true;
  try {
    await criarLookDaSugestao(s, `${(OCASIOES.find((o) => o[0] === estado.ocasiao) || [])[1]} · ${dataBR(new Date().toISOString().slice(0, 10))}`);
    recado("Look salvo em Looks.");
  } catch (erro) {
    recado(erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

async function usarSugestao(s, botao) {
  botao.disabled = true;
  try {
    const lookId = await criarLookDaSugestao(s, `${(OCASIOES.find((o) => o[0] === estado.ocasiao) || [])[1]} · ${dataBR(new Date().toISOString().slice(0, 10))}`);
    const { error } = await sb.rpc("vesty_registrar_uso", { p_look: lookId });
    if (error) throw new Error(error.message);
    recado("Uso registrado. Aproveite o dia!");
    carregarResumo();
  } catch (erro) {
    recado(erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

/* Saber POR QUE a sugestão não serviu é o dado mais valioso do piloto.
   O motivo fica gravado e a peça recusada sai da próxima tentativa. */
const MOTIVOS = [
  ["ocasiao", "Não combina com a ocasião"],
  ["clima", "Não combina com o clima"],
  ["conforto", "Não é confortável"],
  ["estilo", "Não é o meu estilo"],
  ["cores", "As cores não combinam"],
  ["repetido", "Já usei isso há pouco"],
];

function recusarSugestao(s) {
  $("simples-titulo").textContent = "O que não funcionou?";
  const corpo = $("simples-corpo");
  corpo.replaceChildren(
    elemento("p", { class: "muted", texto: "Sua resposta ajusta as próximas sugestões." }),
  );

  const lista = elemento("div", { class: "pilha" });
  for (const [chave, rotulo] of MOTIVOS) {
    lista.append(elemento("button", {
      class: "item",
      type: "button",
      texto: rotulo,
      onclick: async () => {
        try {
          const { data: sessao } = await sb.auth.getUser();
          await sb.from("vesty_feedback").insert({
            dona_id: sessao.user.id,
            aceito: false,
            motivo: chave,
            contexto: {
              ocasiao: estado.ocasiao,
              conforto: estado.conforto,
              pecas: s.pecas.map((p) => ({ id: p.id, nome: p.nome, papel: p.papel })),
              explicacao: s.explicacao_tecnica || s.explicacao,
            },
          });
        } catch { /* o feedback não pode atrapalhar a experiência dela */ }

        $("dialogo-simples").close();
        recado("Obrigada. Vou tentar outra combinação.");
        // Peças recusadas saem da próxima rodada.
        estado.recusadas = [...new Set([...(estado.recusadas || []), ...s.pecas.map((p) => p.id)])];
        $("gerar-look").click();
      },
    }));
  }
  corpo.append(lista);
  $("dialogo-simples").showModal();
}

async function carregarResumo() {
  const { data } = await sb.rpc("vesty_resumo");
  if (!data) return;
  const area = $("resumo-hoje");
  const cartoes = [
    [data.total_pecas, "peças"],
    [data.disponiveis, "disponíveis"],
    [data.looks, "looks"],
    [data.usos_30_dias, "usos em 30 dias"],
  ].map(([valor, rotulo]) =>
    elemento("div", { class: "numero-cartao" }, [
      elemento("div", { class: "valor", texto: String(valor ?? 0) }),
      elemento("div", { class: "rotulo", texto: rotulo }),
    ])
  );

  area.replaceChildren(
    elemento("h2", { texto: "Seu guarda-roupa" }),
    elemento("div", { class: "numeros" }, cartoes),
  );

  if (data.esquecidas > 0) {
    area.append(elemento("div", {
      class: "nota",
      style: "margin-top:12px",
      texto: `${data.esquecidas} peça(s) disponíveis não aparecem em nenhum look há mais de 90 dias.`,
    }));
  }
}

$("atalho-peca").onclick = () => abrirPeca();
$("nova-peca").onclick = () => abrirPeca();
$("atalho-loja").onclick = () => abrirLoja();
$("ir-conta").onclick = () => abrirAba("assistente");

/* ============ CLOSET ============ */

function montarChipsCloset() {
  chips($("chips-categoria"), [["", "Tudo"], ...CATEGORIAS], estado.categoria, (v) => {
    estado.categoria = v;
    montarChipsCloset();
    carregarPecas(true);
  });
  chips($("chips-estado"), [["", "Todas"], ...ESTADOS], estado.disponibilidade, (v) => {
    estado.disponibilidade = v;
    montarChipsCloset();
    carregarPecas(true);
  });
}

let temporizadorBusca;
$("busca").oninput = (e) => {
  clearTimeout(temporizadorBusca);
  estado.busca = e.target.value.trim();
  temporizadorBusca = setTimeout(() => carregarPecas(true), 300);
};

async function carregarPecas(reiniciar = false) {
  if (reiniciar) {
    estado.pagina = 0;
    estado.pecas = [];
    $("grade-pecas").replaceChildren(elemento("p", { class: "carregando", texto: "Abrindo seu guarda-roupa…" }));
  }

  let consulta = sb.from("vesty_pecas").select("*", { count: "exact" });
  if (estado.categoria) consulta = consulta.eq("categoria", estado.categoria);
  if (estado.disponibilidade) consulta = consulta.eq("estado", estado.disponibilidade);
  // O banco guarda uma versão sem acento; normalizamos o que ela digitou para
  // que "calca", "calça" e "CALÇA" encontrem a mesma peça.
  if (estado.busca) {
    consulta = consulta.ilike("busca", `%${semAcento(estado.busca)}%`);
  }

  const de = estado.pagina * POR_PAGINA;
  const { data, count, error } = await consulta
    .order("criado_em", { ascending: false })
    .range(de, de + POR_PAGINA - 1);

  if (error) {
    $("grade-pecas").replaceChildren(elemento("p", { class: "alerta", texto: "Não consegui carregar suas peças." }));
    return;
  }

  estado.pecas = reiniciar ? data : estado.pecas.concat(data);
  estado.total = count ?? estado.pecas.length;
  desenharGrade();
}

function desenharGrade() {
  const grade = $("grade-pecas");
  grade.replaceChildren();
  $("contagem").textContent = estado.total
    ? `${estado.total} peça${estado.total > 1 ? "s" : ""}`
    : "";

  if (!estado.pecas.length) {
    grade.append(elemento("div", {
      class: "vazio",
      texto: estado.busca || estado.categoria || estado.disponibilidade
        ? "Nenhuma peça com esses filtros."
        : "Seu guarda-roupa está esperando. Toque em + Peça para começar.",
    }));
    $("carregar-mais").hidden = true;
    return;
  }

  for (const p of estado.pecas) grade.append(cartaoPeca(p, () => abrirPeca(p)));
  $("carregar-mais").hidden = estado.pecas.length >= estado.total;
}

function cartaoPeca(p, aoClicar, selecionavel = false) {
  const moldura = elemento("div", { class: "moldura" });
  if (p.foto_path) {
    const img = elemento("img", { alt: "", loading: "lazy", hidden: "hidden" });
    moldura.append(img);
    pintarFoto(img, p.foto_path);
  } else {
    moldura.append(marcaCategoria(p.categoria));
  }
  if (p.favorita) moldura.append(elemento("span", { class: "selo favorita", texto: "favorita" }));
  if (p.estado !== "disponivel") {
    moldura.append(elemento("span", { class: "selo", texto: rotuloEstado(p.estado) }));
  }

  const detalhes = [estado.rotulos[p.subcategoria] || p.subcategoria, p.cor].filter(Boolean).join(" · ");

  return elemento("button", {
    class: "card" + (selecionavel ? " selecionavel" : ""),
    type: "button",
    "aria-pressed": selecionavel ? String(estado.selecao.has(p.id)) : null,
    "aria-label": p.nome,
    onclick: aoClicar,
  }, [
    moldura,
    elemento("div", { class: "info" }, [
      elemento("div", { class: "nome", texto: p.nome }),
      elemento("div", { class: "meta", texto: detalhes }),
    ]),
  ]);
}

$("carregar-mais").onclick = () => {
  estado.pagina += 1;
  carregarPecas(false);
};

/* ============ peça: formulário ============ */

function preencherSelects(selCategoria, selSub) {
  selCategoria.replaceChildren(...CATEGORIAS.map(([v, t]) => new Option(t, v)));
  const atualizar = () => {
    const lista = estado.subcategorias[selCategoria.value] || [];
    selSub.replaceChildren(...lista.map(([v, t]) => new Option(t, v)));
  };
  selCategoria.onchange = atualizar;
  atualizar();
}

let ocasioesPeca = [];
let climasPeca = [];

// A cliente não deveria digitar o nome de quinze peças seguidas: ele sai do que
// ela já escolheu. Se ela escrever o próprio nome, paramos de mexer.
let nomeEditadoAMao = false;

function sugerirNome() {
  if (nomeEditadoAMao) return;
  const form = $("form-peca");
  // O singular vem do banco: regra automática erra em português — "Jeans"
  // viraria "Jean" e "Tênis" viraria "Tênl".
  const singular = estado.singulares[form.subcategoria.value];
  if (!singular) return;
  const cor = form.cor.value.trim();
  form.nome.value = cor ? `${singular} ${cor.toLowerCase()}` : singular;
}

function prepararFormularioPeca() {
  preencherSelects($("peca-categoria"), $("peca-subcategoria"));
  preencherSelects($("loja-categoria"), $("loja-subcategoria"));
  $("peca-estado").replaceChildren(...ESTADOS.map(([v, t]) => new Option(t, v)));
  desenharChipsPeca();

  const form = $("form-peca");
  form.nome.addEventListener("input", () => {
    nomeEditadoAMao = form.nome.value.trim() !== "";
  });
  for (const campo of [$("peca-subcategoria"), form.cor]) {
    campo.addEventListener("input", sugerirNome);
    campo.addEventListener("change", sugerirNome);
  }
  // A troca de categoria repovoa as subcategorias; sugerimos depois disso.
  $("peca-categoria").addEventListener("change", () => setTimeout(sugerirNome, 0));
}

function desenharChipsPeca() {
  chips($("peca-ocasioes"), OCASIOES, ocasioesPeca, (v) => {
    ocasioesPeca = ocasioesPeca.includes(v) ? ocasioesPeca.filter((x) => x !== v) : [...ocasioesPeca, v];
    desenharChipsPeca();
  }, true);
  chips($("peca-clima"), CLIMAS, climasPeca, (v) => {
    climasPeca = climasPeca.includes(v) ? climasPeca.filter((x) => x !== v) : [...climasPeca, v];
    desenharChipsPeca();
  }, true);
}

function abrirPeca(peca = null, opcoes = {}) {
  estado.editando = peca;
  estado.fotoPendente = null;
  nomeEditadoAMao = false;
  const form = $("form-peca");
  form.reset();
  alerta("peca-alerta", "");

  if (!peca) contadorDaSessao = opcoes.manterCategoria ? contadorDaSessao : 0;
  $("peca-titulo").textContent = peca ? "Detalhes da peça" : "Nova peça";
  $("excluir-peca").hidden = !peca;
  $("peca-foto").hidden = true;
  $("peca-foto").removeAttribute("src");
  $("peca-instrucao").hidden = false;
  // Detalhes opcionais começam recolhidos em peça nova e abertos ao revisar.
  $("mais-detalhes").open = Boolean(peca);

  ocasioesPeca = peca?.ocasioes ? [...peca.ocasioes] : [];
  climasPeca = peca?.clima ? [...peca.clima] : [];

  if (peca) {
    nomeEditadoAMao = true; // nunca sobrescrever o nome que ela já deu
    form.nome.value = peca.nome;
    $("peca-categoria").value = peca.categoria;
    $("peca-categoria").onchange();
    form.subcategoria.value = peca.subcategoria;
    form.cor.value = peca.cor || "";
    form.estampa.value = peca.estampa || "";
    form.marca.value = peca.marca || "";
    form.tamanho.value = peca.tamanho || "";
    form.estado.value = peca.estado;
    form.notas.value = peca.notas || "";
    form.favorita.checked = peca.favorita;
    form.preco.value = peca.preco_centavos == null ? "" : (peca.preco_centavos / 100).toFixed(2);
    if (peca.foto_path) {
      $("peca-instrucao").hidden = true;
      pintarFoto($("peca-foto"), peca.foto_path);
    }
  } else if (opcoes.manterCategoria) {
    // Quem está cadastrando várias blusas seguidas não quer reescolher a categoria.
    $("peca-categoria").value = opcoes.manterCategoria;
    $("peca-categoria").onchange();
    sugerirNome();
  } else {
    sugerirNome();
  }

  desenharChipsPeca();
  if (!$("dialogo-peca").open) $("dialogo-peca").showModal();
  $("dialogo-peca").querySelector(".folha").scrollTop = 0;
}

$("tirar-foto").onclick = () => $("arquivo-camera").click();
$("escolher-foto").onclick = () => $("arquivo-galeria").click();

for (const id of ["arquivo-camera", "arquivo-galeria"]) {
  $(id).onchange = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    try {
      const blob = await prepararImagem(arquivo);
      estado.fotoPendente = blob;
      $("peca-instrucao").hidden = true;
      const img = $("peca-foto");
      img.src = URL.createObjectURL(blob);
      img.hidden = false;
      recado("Foto pronta. Confira os dados e salve.");
    } catch (erro) {
      alerta("peca-alerta", erro.message);
    }
  };
}

$("form-peca").onsubmit = async (e) => {
  e.preventDefault();
  const botao = $("salvar-peca");
  botao.disabled = true;
  alerta("peca-alerta", "");

  try {
    const form = e.target;
    const { data: sessao } = await sb.auth.getUser();
    const valores = {
      dona_id: sessao.user.id,
      nome: form.nome.value.trim(),
      categoria: form.categoria.value,
      subcategoria: form.subcategoria.value,
      cor: form.cor.value.trim(),
      estampa: form.estampa.value.trim(),
      marca: form.marca.value.trim(),
      tamanho: form.tamanho.value.trim(),
      estado: form.estado.value,
      notas: form.notas.value.trim(),
      favorita: form.favorita.checked,
      ocasioes: ocasioesPeca,
      clima: climasPeca,
      preco_centavos: form.preco.value === "" ? null : Math.round(Number(form.preco.value) * 100),
    };

    if (!valores.nome) throw new Error("Dê um nome para a peça.");

    if (estado.fotoPendente) {
      valores.foto_path = await enviarFoto(estado.fotoPendente);
    }

    if (estado.editando) {
      const { error } = await sb.from("vesty_pecas").update(valores).eq("id", estado.editando.id);
      if (error) throw new Error(error.message);
      recado("Peça atualizada.");
    } else {
      const { error } = await sb.from("vesty_pecas").insert(valores);
      if (error) throw new Error(error.message);
      recado(continuar ? "Guardada. Vamos para a próxima." : "Peça guardada no seu closet.");
    }

    if (continuar) {
      // Cadastro em sequência: mantém a categoria escolhida e já pede a foto
      // seguinte, para não precisar reabrir o formulário a cada peça.
      const categoria = form.categoria.value;
      abrirPeca(null, { manterCategoria: categoria });
      contadorDaSessao += 1;
      $("peca-titulo").textContent = `Nova peça · ${contadorDaSessao} nesta sessão`;
    } else {
      $("dialogo-peca").close();
    }
    if (estado.aba === "closet") carregarPecas(true);
    else carregarResumo();
  } catch (erro) {
    alerta("peca-alerta", erro.message);
  } finally {
    botao.disabled = false;
    continuar = false;
  }
};

let continuar = false;
let contadorDaSessao = 0;

$("salvar-e-outra").onclick = () => {
  continuar = true;
  $("form-peca").requestSubmit();
};

$("excluir-peca").onclick = async () => {
  if (!estado.editando) return;
  const ok = confirm(
    "Excluir apaga a peça e o histórico de uso dela. Para manter os dados, você pode arquivar. Excluir mesmo assim?",
  );
  if (!ok) return;
  const { error } = await sb.from("vesty_pecas").delete().eq("id", estado.editando.id);
  if (error) { recado(error.message, "erro"); return; }
  if (estado.editando.foto_path) {
    await sb.storage.from(BUCKET).remove([estado.editando.foto_path]);
  }
  $("dialogo-peca").close();
  recado("Peça excluída.");
  carregarPecas(true);
};

/* ============ LOOKS ============ */

function montarChipsLooks() {
  chips($("chips-looks"), [["salvos", "Salvos"], ["agenda", "Minha semana"], ["viagem", "Viagens"]],
    estado.abaLooks, (v) => {
      estado.abaLooks = v;
      montarChipsLooks();
      $("painel-salvos").hidden = v !== "salvos";
      $("painel-agenda").hidden = v !== "agenda";
      $("painel-viagem").hidden = v !== "viagem";
      if (v === "agenda") carregarAgenda();
      if (v === "viagem") carregarViagens();
      if (v === "salvos") carregarLooks();
    });
}

async function carregarLooks() {
  const lista = $("lista-looks");
  lista.replaceChildren(elemento("p", { class: "carregando", texto: "Buscando seus looks…" }));

  const { data, error } = await sb
    .from("vesty_looks")
    .select("*, vesty_look_pecas(peca_id, vesty_pecas(id,nome,categoria,foto_path))")
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) { lista.replaceChildren(elemento("p", { class: "alerta", texto: "Não consegui carregar." })); return; }

  lista.replaceChildren();
  if (!data.length) {
    lista.append(elemento("div", {
      class: "vazio",
      texto: "Você ainda não salvou combinações. Monte uma ou peça uma sugestão na aba Hoje.",
    }));
    return;
  }

  for (const look of data) {
    const pecas = (look.vesty_look_pecas || []).map((x) => x.vesty_pecas).filter(Boolean);
    const minis = elemento("span", { class: "miniaturas" });
    for (const p of pecas.slice(0, 4)) {
      const cx = elemento("span", {});
      if (p.foto_path) {
        const img = elemento("img", { alt: "", loading: "lazy" });
        cx.append(img);
        pintarFoto(img, p.foto_path);
      } else {
        cx.textContent = inicial(p.nome);
      }
      minis.append(cx);
    }

    lista.append(elemento("button", {
      class: "item",
      type: "button",
      onclick: () => verLook(look, pecas),
    }, [
      minis,
      elemento("span", { class: "corpo" }, [
        elemento("span", { class: "titulo", texto: look.nome }),
        elemento("span", {
          class: "detalhe",
          texto: `${pecas.length} peça(s)${look.ocasiao ? " · " + look.ocasiao : ""}`,
        }),
      ]),
    ]));
  }
}

function verLook(look, pecas) {
  $("simples-titulo").textContent = look.nome;
  const corpo = $("simples-corpo");
  corpo.replaceChildren();

  const grade = elemento("div", { class: "pecas", style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:10px" });
  for (const p of pecas) {
    const moldura = elemento("div", { class: "moldura" });
    if (p.foto_path) {
      const img = elemento("img", { alt: "", hidden: "hidden" });
      moldura.append(img);
      pintarFoto(img, p.foto_path);
    } else moldura.append(marcaCategoria(p.categoria));
    grade.append(elemento("div", { class: "peca-mini" }, [moldura, elemento("div", { class: "nome", texto: p.nome })]));
  }
  corpo.append(grade);

  if (look.explicacao) {
    corpo.append(elemento("p", { class: "explicacao", style: "margin-top:14px", texto: look.explicacao }));
  }

  corpo.append(elemento("div", { class: "acoes", style: "margin-top:16px" }, [
    elemento("button", {
      texto: "Usei hoje",
      onclick: async (e) => {
        e.target.disabled = true;
        const { error } = await sb.rpc("vesty_registrar_uso", { p_look: look.id });
        recado(error ? error.message : "Uso registrado.", error ? "erro" : "");
        e.target.disabled = false;
        if (!error) $("dialogo-simples").close();
      },
    }),
    elemento("button", {
      class: "secundario",
      texto: look.favorito ? "Tirar dos favoritos" : "Favoritar",
      onclick: async (e) => {
        e.target.disabled = true;
        await sb.from("vesty_looks").update({ favorito: !look.favorito }).eq("id", look.id);
        $("dialogo-simples").close();
        carregarLooks();
      },
    }),
    elemento("button", {
      class: "perigo",
      texto: "Excluir look",
      onclick: async () => {
        if (!confirm("Excluir esta combinação? Suas peças continuam no closet.")) return;
        await sb.from("vesty_looks").delete().eq("id", look.id);
        $("dialogo-simples").close();
        carregarLooks();
        recado("Look excluído.");
      },
    }),
  ]));

  $("dialogo-simples").showModal();
}

/* ============ montar look manual ============ */

let filtroLook = "";

$("novo-look").onclick = () => abrirMontarLook();

async function abrirMontarLook() {
  estado.selecao = new Set();
  filtroLook = "";
  $("look-nome").value = "";
  alerta("look-alerta", "");
  $("dialogo-look").showModal();
  desenharFiltroLook();
  await desenharGradeLook();
}

function desenharFiltroLook() {
  chips($("look-filtro"), [["", "Tudo"], ...CATEGORIAS], filtroLook, async (v) => {
    filtroLook = v;
    desenharFiltroLook();
    await desenharGradeLook();
  });
}

async function desenharGradeLook() {
  const grade = $("look-grade");
  grade.replaceChildren(elemento("p", { class: "carregando", texto: "Carregando peças disponíveis…" }));

  let consulta = sb.from("vesty_pecas").select("*").eq("estado", "disponivel");
  if (filtroLook) consulta = consulta.eq("categoria", filtroLook);
  const { data } = await consulta.order("nome").limit(200);

  grade.replaceChildren();
  if (!data?.length) {
    grade.append(elemento("div", { class: "vazio", texto: "Nenhuma peça disponível nesta categoria." }));
    return;
  }

  for (const p of data) {
    grade.append(cartaoPeca(p, () => {
      if (estado.selecao.has(p.id)) estado.selecao.delete(p.id);
      else estado.selecao.add(p.id);
      desenharGradeLook();
    }, true));
  }
  $("look-contagem").textContent = estado.selecao.size
    ? `${estado.selecao.size} peça(s) escolhidas`
    : "Toque nas peças que você quer usar.";
}

$("salvar-look").onclick = async () => {
  alerta("look-alerta", "");
  if (!estado.selecao.size) { alerta("look-alerta", "Escolha pelo menos uma peça."); return; }
  const nome = $("look-nome").value.trim() || "Meu look";
  const botao = $("salvar-look");
  botao.disabled = true;
  try {
    const { error } = await sb.rpc("vesty_salvar_look", {
      p_nome: nome,
      p_pecas: [...estado.selecao],
      p_origem: "manual",
    });
    if (error) throw new Error(error.message);
    $("dialogo-look").close();
    recado("Combinação salva.");
    estado.abaLooks = "salvos";
    montarChipsLooks();
    carregarLooks();
  } catch (erro) {
    alerta("look-alerta", erro.message);
  } finally {
    botao.disabled = false;
  }
};

/* ============ agenda ============ */

async function carregarAgenda() {
  const lista = $("lista-agenda");
  lista.replaceChildren(elemento("p", { class: "carregando", texto: "Carregando…" }));
  const hoje = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("vesty_agenda")
    .select("*, vesty_looks(nome)")
    .gte("data", hoje)
    .order("data")
    .limit(30);

  lista.replaceChildren();
  if (!data?.length) {
    lista.append(elemento("div", { class: "vazio", texto: "Nenhum compromisso planejado." }));
    return;
  }
  for (const c of data) {
    lista.append(elemento("div", { class: "item" }, [
      elemento("span", { class: "numero", texto: c.data.slice(8, 10) }),
      elemento("span", { class: "corpo" }, [
        elemento("span", { class: "titulo", texto: c.titulo || c.ocasiao || "Compromisso" }),
        elemento("span", {
          class: "detalhe",
          texto: `${dataBR(c.data)}${c.vesty_looks ? " · " + c.vesty_looks.nome : " · sem look definido"}`,
        }),
      ]),
      elemento("button", {
        class: "discreto",
        texto: "Remover",
        onclick: async () => {
          await sb.from("vesty_agenda").delete().eq("id", c.id);
          carregarAgenda();
        },
      }),
    ]));
  }
}

$("novo-compromisso").onclick = async () => {
  const { data: looks } = await sb.from("vesty_looks").select("id,nome").order("criado_em", { ascending: false }).limit(50);

  $("simples-titulo").textContent = "Planejar um dia";
  const form = elemento("form", {});
  form.innerHTML = `
    <label>Dia<input type="date" name="data" required></label>
    <label>O que você tem nesse dia?<input name="titulo" maxlength="160" placeholder="Ex.: Reunião com cliente"></label>
    <label>Ocasião<select name="ocasiao"></select></label>
    <label>Look (opcional)<select name="look"></select></label>
    <button type="submit" class="largo">Salvar no planejamento</button>
  `;
  form.ocasiao.replaceChildren(...OCASIOES.map(([v, t]) => new Option(t, v)));
  form.look.replaceChildren(new Option("Decidir depois", ""), ...(looks || []).map((l) => new Option(l.nome, l.id)));
  form.querySelector('[name="data"]').min = new Date().toISOString().slice(0, 10);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const { data: sessao } = await sb.auth.getUser();
    const { error } = await sb.from("vesty_agenda").insert({
      dona_id: sessao.user.id,
      data: form.data.value,
      titulo: form.titulo.value.trim(),
      ocasiao: form.ocasiao.value,
      look_id: form.look.value || null,
    });
    if (error) { recado(error.message, "erro"); return; }
    $("dialogo-simples").close();
    recado("Planejado. Isso não conta como uso.");
    carregarAgenda();
  };

  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
};

/* ============ viagens ============ */

async function carregarViagens() {
  const lista = $("lista-viagens");
  lista.replaceChildren(elemento("p", { class: "carregando", texto: "Carregando…" }));
  const { data } = await sb.from("vesty_viagens").select("*").order("inicio", { ascending: false }).limit(20);

  lista.replaceChildren();
  if (!data?.length) {
    lista.append(elemento("div", { class: "vazio", texto: "Nenhuma viagem planejada." }));
    return;
  }
  for (const v of data) {
    const dias = Math.round((new Date(v.fim) - new Date(v.inicio)) / 86400000) + 1;
    lista.append(elemento("button", {
      class: "item",
      type: "button",
      onclick: () => abrirMala(v),
    }, [
      elemento("span", { class: "corpo" }, [
        elemento("span", { class: "titulo", texto: v.destino }),
        elemento("span", { class: "detalhe", texto: `${dias} dia(s) · ${dataBR(v.inicio)}` }),
      ]),
    ]));
  }
}

$("nova-viagem").onclick = () => {
  $("simples-titulo").textContent = "Planejar viagem";
  const form = elemento("form", {});
  form.innerHTML = `
    <label>Destino<input name="destino" required maxlength="120" placeholder="Ex.: São Paulo"></label>
    <div class="linha-dupla">
      <label>Ida<input type="date" name="inicio" required></label>
      <label>Volta<input type="date" name="fim" required></label>
    </div>
    <button type="submit" class="largo">Criar viagem</button>
  `;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (form.fim.value < form.inicio.value) { recado("A volta não pode ser antes da ida.", "erro"); return; }
    const { data: sessao } = await sb.auth.getUser();
    const { error } = await sb.from("vesty_viagens").insert({
      dona_id: sessao.user.id,
      destino: form.destino.value.trim(),
      inicio: form.inicio.value,
      fim: form.fim.value,
    });
    if (error) { recado(error.message, "erro"); return; }
    $("dialogo-simples").close();
    recado("Viagem criada. Agora escolha as peças da mala.");
    carregarViagens();
  };
  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
};

async function abrirMala(viagem) {
  $("simples-titulo").textContent = `Mala · ${viagem.destino}`;
  const corpo = $("simples-corpo");
  corpo.replaceChildren(elemento("p", { class: "carregando", texto: "Montando a lista…" }));
  $("dialogo-simples").showModal();

  const { data: naMala } = await sb
    .from("vesty_viagem_pecas")
    .select("peca_id, separada, vesty_pecas(id,nome,categoria,foto_path)")
    .eq("viagem_id", viagem.id);

  corpo.replaceChildren();
  corpo.append(elemento("p", {
    class: "muted",
    texto: `${dataBR(viagem.inicio)} a ${dataBR(viagem.fim)} · cada peça aparece uma vez, mesmo usada em vários looks.`,
  }));

  const lista = elemento("div", { class: "pilha" });
  if (!naMala?.length) {
    lista.append(elemento("div", { class: "vazio", texto: "Mala vazia. Adicione peças abaixo." }));
  }
  for (const linha of naMala || []) {
    const p = linha.vesty_pecas;
    if (!p) continue;
    const caixa = elemento("input", { type: "checkbox", style: "width:auto;min-height:0;margin:0" });
    caixa.checked = linha.separada;
    caixa.onchange = async () => {
      await sb.from("vesty_viagem_pecas")
        .update({ separada: caixa.checked })
        .eq("viagem_id", viagem.id).eq("peca_id", p.id);
    };
    lista.append(elemento("label", {
      class: "item",
      style: "margin:0;display:flex;align-items:center;gap:12px",
    }, [
      caixa,
      elemento("span", { class: "corpo" }, [
        elemento("span", { class: "titulo", texto: p.nome }),
        elemento("span", { class: "detalhe", texto: rotuloCategoria(p.categoria) }),
      ]),
      elemento("button", {
        class: "discreto",
        type: "button",
        texto: "Tirar",
        onclick: async () => {
          await sb.from("vesty_viagem_pecas").delete().eq("viagem_id", viagem.id).eq("peca_id", p.id);
          abrirMala(viagem);
        },
      }),
    ]));
  }
  corpo.append(lista);

  corpo.append(elemento("button", {
    class: "secundario largo",
    style: "margin-top:14px",
    texto: "+ Adicionar peças à mala",
    onclick: () => escolherPecasMala(viagem, (naMala || []).map((x) => x.peca_id)),
  }));

  corpo.append(elemento("button", {
    class: "perigo largo",
    style: "margin-top:10px",
    texto: "Excluir viagem",
    onclick: async () => {
      if (!confirm("Excluir esta viagem e sua lista de mala?")) return;
      await sb.from("vesty_viagens").delete().eq("id", viagem.id);
      $("dialogo-simples").close();
      carregarViagens();
    },
  }));
}

async function escolherPecasMala(viagem, jaNaMala) {
  const corpo = $("simples-corpo");
  corpo.replaceChildren(elemento("p", { class: "carregando", texto: "Carregando peças…" }));
  const { data } = await sb.from("vesty_pecas").select("*").eq("estado", "disponivel").order("nome").limit(200);

  corpo.replaceChildren(elemento("p", { class: "muted", texto: "Toque para colocar na mala." }));
  const grade = elemento("div", { class: "grade" });
  const dentro = new Set(jaNaMala);

  for (const p of data || []) {
    if (dentro.has(p.id)) continue;
    grade.append(cartaoPeca(p, async (e) => {
      const { data: sessao } = await sb.auth.getUser();
      const { error } = await sb.from("vesty_viagem_pecas").insert({
        viagem_id: viagem.id, peca_id: p.id, dona_id: sessao.user.id,
      });
      if (error) { recado(error.message, "erro"); return; }
      recado(`${p.nome} na mala.`);
      e.target.closest(".card").remove();
    }));
  }
  corpo.append(grade);
  corpo.append(elemento("button", {
    class: "largo",
    style: "margin-top:14px",
    texto: "Voltar para a mala",
    onclick: () => abrirMala(viagem),
  }));
}

/* ============ conferir na loja ============ */

function abrirLoja() {
  $("form-loja").reset();
  estado.fotoLoja = null;
  $("loja-foto").hidden = true;
  $("loja-resultado").replaceChildren();
  alerta("loja-alerta", "");
  $("dialogo-loja").showModal();
}

$("loja-tirar").onclick = () => $("loja-arquivo-camera").click();
$("loja-galeria").onclick = () => $("loja-arquivo-galeria").click();

for (const id of ["loja-arquivo-camera", "loja-arquivo-galeria"]) {
  $(id).onchange = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    try {
      const blob = await prepararImagem(arquivo);
      estado.fotoLoja = blob;
      const img = $("loja-foto");
      img.src = URL.createObjectURL(blob);
      img.hidden = false;
      $("loja-foto-area").querySelector(".instrucao").hidden = true;
    } catch (erro) {
      alerta("loja-alerta", erro.message);
    }
  };
}

$("form-loja").onsubmit = async (e) => {
  e.preventDefault();
  alerta("loja-alerta", "");
  const form = e.target;
  const categoria = form.categoria.value;
  const subcategoria = form.subcategoria.value;
  const cor = form.cor.value.trim();

  const { data: semelhantes, error } = await sb.rpc("vesty_semelhantes", {
    p_categoria: categoria,
    p_subcategoria: subcategoria,
    p_cor: cor,
  });
  if (error) { alerta("loja-alerta", error.message); return; }

  const { data: combinam } = await sb
    .from("vesty_pecas")
    .select("id,nome,cor,foto_path,categoria,subcategoria")
    .eq("estado", "disponivel")
    .neq("categoria", categoria)
    .limit(6);

  const area = $("loja-resultado");
  area.replaceChildren();

  area.append(elemento("h3", { style: "margin-top:20px", texto: "Você já tem algo parecido?" }));
  if (semelhantes?.length) {
    const lista = elemento("div", { class: "pilha" });
    for (const s of semelhantes.slice(0, 5)) {
      lista.append(elemento("div", { class: "item" }, [
        elemento("span", { class: "corpo" }, [
          elemento("span", { class: "titulo", texto: s.nome }),
          elemento("span", { class: "detalhe", texto: s.motivo }),
        ]),
      ]));
    }
    area.append(lista);
    area.append(elemento("p", {
      class: "muted",
      style: "margin-top:8px",
      texto: "Comparação pelos dados que você cadastrou, não por análise da foto. Confira olhando a peça.",
    }));
  } else {
    area.append(elemento("div", { class: "nota", style: "margin-top:10px", texto: "Nada parecido no seu guarda-roupa." }));
  }

  area.append(elemento("h3", { style: "margin-top:22px", texto: "Combina com o que você tem" }));
  if (combinam?.length) {
    const grade = elemento("div", { class: "grade" });
    for (const p of combinam) grade.append(cartaoPeca(p, () => {}));
    area.append(grade);
  } else {
    area.append(elemento("p", { class: "muted", texto: "Cadastre mais peças para eu mostrar combinações." }));
  }

  area.append(elemento("div", { class: "acoes", style: "margin-top:20px" }, [
    elemento("button", { texto: "Comprei — guardar no closet", onclick: () => salvarDesejo("comprei", form) }),
    elemento("button", { class: "secundario", texto: "Guardar na lista de desejos", onclick: () => salvarDesejo("pendente", form) }),
  ]));
};

async function salvarDesejo(decisao, form) {
  try {
    const { data: sessao } = await sb.auth.getUser();
    const dona = sessao.user.id;
    let caminho = null;
    if (estado.fotoLoja) caminho = await enviarFoto(estado.fotoLoja, "desejos");

    const preco = form.preco.value === "" ? null : Math.round(Number(form.preco.value) * 100);
    let pecaId = null;

    if (decisao === "comprei") {
      const { data: nova, error } = await sb.from("vesty_pecas").insert({
        dona_id: dona,
        nome: `${estado.singulares[form.subcategoria.value] || form.subcategoria.value} ${form.cor.value.trim().toLowerCase()}`.trim(),
        categoria: form.categoria.value,
        subcategoria: form.subcategoria.value,
        cor: form.cor.value.trim(),
        preco_centavos: preco,
        foto_path: caminho,
        comprado_em: new Date().toISOString().slice(0, 10),
      }).select().single();
      if (error) throw new Error(error.message);
      pecaId = nova.id;
    }

    const { error: erroDesejo } = await sb.from("vesty_desejos").insert({
      dona_id: dona,
      categoria: form.categoria.value,
      subcategoria: form.subcategoria.value,
      cor: form.cor.value.trim(),
      loja: form.loja.value.trim(),
      preco_centavos: preco,
      foto_path: caminho,
      decisao,
      peca_id: pecaId,
    });
    if (erroDesejo) throw new Error(erroDesejo.message);

    $("dialogo-loja").close();
    recado(decisao === "comprei" ? "Peça adicionada ao seu closet." : "Guardado na lista de desejos.");
    if (estado.aba === "closet") carregarPecas(true);
  } catch (erro) {
    alerta("loja-alerta", erro.message);
  }
}

/* ============ ASSISTENTE ============ */

function balao(texto, quem = "vesty") {
  return elemento("div", { class: "balao " + quem }, [
    quem === "vesty" ? elemento("div", { class: "assinatura", texto: "VESTY" }) : null,
    elemento("div", { texto }),
  ]);
}

function saudacaoAssistente() {
  const nome = (estado.perfil?.nome || "").split(" ")[0];
  $("conversa").replaceChildren(
    balao(
      `Oi${nome ? ", " + nome : ""}. Eu trabalho com as peças que você cadastrou: ` +
      `monto combinações, considero o clima da sua cidade e lembro do que você me ensina. ` +
      `Quando eu não souber algo, eu digo — não invento.`,
    ),
  );
  chips($("sugestoes-pergunta"), [
    ["o que eu visto hoje?", "O que visto hoje?"],
    ["quantas peças eu tenho?", "Meu guarda-roupa"],
    ["o que está esquecido?", "Peças esquecidas"],
    ["o que tenho para lavar?", "Para lavar"],
  ], "", (texto) => {
    $("pergunta").value = texto;
    $("form-pergunta").requestSubmit();
  });
}

function dizer(texto, quem = "vesty") {
  const el = balao(texto, quem);
  $("conversa").append(el);
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return el;
}

/* O assistente responde sobre os dados reais da cliente. Quando não entende,
   diz que não entendeu — nunca inventa uma resposta plausível. */
async function responder(texto) {
  const p = texto.toLowerCase();
  const tem = (...termos) => termos.some((t) => p.includes(t));

  // Ensinar uma preferência
  if (tem("não gosto", "nao gosto", "prefiro", "evito", "não uso", "nao uso", "detesto")) {
    const { data: sessao } = await sb.auth.getUser();
    const semSalto = tem("salto", "scarpin");
    const chave = semSalto ? "sem_salto" : "observacao";
    const valor = semSalto ? tem("não", "nao", "evito", "detesto") : texto.trim();
    const { error } = await sb.from("vesty_preferencias").upsert({
      dona_id: sessao.user.id, chave, valor, origem: "declarada",
    });
    if (error) return dizer("Não consegui guardar isso agora. Tente de novo em instantes.");
    carregarMemoria();
    return dizer(
      semSalto
        ? "Anotado: vou deixar o salto de fora das próximas sugestões. Você pode mudar isso na lista abaixo."
        : "Guardei essa observação na minha memória. Ela aparece logo abaixo e você pode corrigir ou apagar.",
    );
  }

  // Look do dia
  if (tem("visto hoje", "vestir hoje", "que uso hoje", "monta um look", "sugest", "look")) {
    dizer("Vou montar com o que está disponível. Um instante…");
    abrirAba("hoje");
    setTimeout(() => $("gerar-look").click(), 400);
    return;
  }

  // Panorama do guarda-roupa
  if (tem("quantas peças", "quantas pecas", "meu guarda-roupa", "quanto eu tenho", "tamanho do closet")) {
    const { data } = await sb.rpc("vesty_resumo");
    if (!data) return dizer("Não consegui consultar agora.");
    const investido = data.investido_centavos
      ? ` Você registrou ${dinheiro(data.investido_centavos)} em preços informados.`
      : "";
    return dizer(
      `Você tem ${data.total_pecas} peça(s) cadastradas, sendo ${data.disponiveis} disponíveis agora. ` +
      `Guardei ${data.looks} combinação(ões) e ${data.usos_30_dias} uso(s) nos últimos 30 dias.${investido}`,
    );
  }

  // Peças esquecidas
  if (tem("esquecid", "não uso há", "nao uso ha", "parada", "sem usar", "pouco usada")) {
    const { data } = await sb.rpc("vesty_estatisticas");
    const paradas = (data || []).filter((d) => d.usos === 0 && d.estado === "disponivel");
    if (!paradas.length) {
      return dizer("Todas as suas peças disponíveis já têm registro de uso. Isso é raro e muito bom.");
    }
    return dizer(
      `${paradas.length} peça(s) disponíveis ainda não têm registro de uso: ` +
      `${paradas.slice(0, 5).map((d) => d.nome).join(", ")}` +
      `${paradas.length > 5 ? " e outras" : ""}. Quer que eu monte um look com alguma delas?`,
    );
  }

  // Cuidados
  if (tem("lavar", "lavanderia", "ajuste", "conserto")) {
    const { data } = await sb.from("vesty_pecas").select("nome,estado")
      .in("estado", ["lavanderia", "ajuste"]);
    if (!data?.length) return dizer("Nenhuma peça marcada para lavar ou ajustar no momento.");
    const porEstado = data.map((d) => `${d.nome} (${rotuloEstado(d.estado).toLowerCase()})`);
    return dizer(`Estão fora de uso agora: ${porEstado.join(", ")}.`);
  }

  // Busca por categoria
  for (const [slug, rotulo] of CATEGORIAS) {
    if (p.includes(rotulo.toLowerCase()) || p.includes(slug)) {
      const { data } = await sb.from("vesty_pecas").select("nome").eq("categoria", slug).limit(12);
      if (!data?.length) return dizer(`Você ainda não cadastrou nada em ${rotulo.toLowerCase()}.`);
      return dizer(`Em ${rotulo.toLowerCase()} você tem: ${data.map((d) => d.nome).join(", ")}.`);
    }
  }

  // Clima
  if (tem("tempo", "clima", "chuva", "frio", "calor", "temperatura")) {
    const texto = $("clima-caixa").textContent.trim().replace(/\s+/g, " ");
    return dizer(
      estado.perfil?.cidade
        ? `A previsão que estou usando é: ${texto}.`
        : "Ainda não sei sua cidade. Cadastre em Meu perfil, logo abaixo, para eu considerar o clima.",
    );
  }

  return dizer(
    "Ainda não entendi essa. Eu sei responder sobre as suas peças, o que está esquecido, " +
    "o que está para lavar, montar um look e guardar preferências suas. " +
    "Tente, por exemplo: “o que eu visto hoje?”.",
  );
}

$("form-pergunta").onsubmit = async (e) => {
  e.preventDefault();
  const texto = $("pergunta").value.trim();
  if (!texto) return;
  $("pergunta").value = "";
  dizer(texto, "cliente");
  const botao = $("enviar-pergunta");
  botao.disabled = true;
  try {
    await responder(texto);
  } catch {
    dizer("Tive um problema para consultar seus dados agora. Tente novamente em instantes.");
  } finally {
    botao.disabled = false;
  }
};

async function carregarMemoria() {
  const area = $("memoria");
  const { data } = await sb.from("vesty_preferencias").select("*").order("atualizado_em", { ascending: false });

  area.replaceChildren();
  if (!data?.length) {
    area.append(elemento("p", {
      class: "muted",
      texto: "Ainda não guardei nenhuma preferência. Use o botão abaixo para me ensinar algo — por exemplo, que você evita salto.",
    }));
    return;
  }

  for (const p of data) {
    const valor = typeof p.valor === "string" ? p.valor : JSON.stringify(p.valor);
    area.append(elemento("div", { class: "memoria-linha" }, [
      elemento("span", { class: "corpo" }, [
        elemento("span", { class: "chave", texto: rotularChave(p.chave) }),
        elemento("span", { class: "valor", texto: valor === "true" ? "Sim" : valor === "false" ? "Não" : valor }),
      ]),
      elemento("span", { class: "origem", texto: p.origem }),
      elemento("button", {
        class: "discreto",
        texto: "Apagar",
        onclick: async () => {
          await sb.from("vesty_preferencias").delete().eq("chave", p.chave);
          carregarMemoria();
          recado("Preferência apagada.");
        },
      }),
    ]));
  }
}

const CHAVES = {
  sem_salto: "Evitar salto",
  cidade: "Minha cidade",
  cores_preferidas: "Cores que eu gosto",
  cores_evitadas: "Cores que eu evito",
  conforto: "Conforto preferido",
  observacao: "Observação",
};
const rotularChave = (c) => CHAVES[c] || c.replaceAll("_", " ");

$("nova-memoria").onclick = () => {
  $("simples-titulo").textContent = "Ensinar uma preferência";
  const form = elemento("form", {});
  form.innerHTML = `
    <label>Sobre o quê?<select name="chave"></select></label>
    <label>O que eu devo lembrar?<input name="valor" maxlength="200" required placeholder="Ex.: prefiro tons neutros"></label>
    <small>Você pode corrigir ou apagar isso a qualquer momento.</small>
    <button type="submit" class="largo" style="margin-top:14px">Guardar</button>
  `;
  form.chave.replaceChildren(...Object.entries(CHAVES).map(([v, t]) => new Option(t, v)));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const { data: sessao } = await sb.auth.getUser();
    const chave = form.chave.value;
    const bruto = form.valor.value.trim();
    const valor = chave === "sem_salto"
      ? /^(sim|s|true|1)$/i.test(bruto)
      : bruto;

    const { error } = await sb.from("vesty_preferencias").upsert({
      dona_id: sessao.user.id, chave, valor, origem: "declarada",
    });
    if (error) { recado(error.message, "erro"); return; }
    if (chave === "cidade") {
      estado.perfil.cidade = bruto;
      await sb.from("vesty_perfis").update({ cidade: bruto }).eq("id", sessao.user.id);
      atualizarClima();
    }
    $("dialogo-simples").close();
    carregarMemoria();
    recado("Guardado. Vou considerar isso nas próximas sugestões.");
  };

  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
};

async function carregarEstatisticas() {
  const area = $("estatisticas");
  const { data } = await sb.rpc("vesty_estatisticas");
  area.replaceChildren();

  if (!data?.length) {
    area.append(elemento("p", { class: "muted", texto: "Cadastre peças e registre usos para ver seus números." }));
    return;
  }

  const usadas = data.filter((d) => d.usos > 0).slice(0, 5);
  const paradas = data.filter((d) => d.usos === 0);

  if (usadas.length) {
    area.append(elemento("h3", { style: "margin-top:14px", texto: "Mais usadas" }));
    const lista = elemento("div", { class: "pilha" });
    for (const d of usadas) {
      const custo = d.custo_por_uso_centavos
        ? ` · ${dinheiro(Number(d.custo_por_uso_centavos))} por uso`
        : "";
      lista.append(elemento("div", { class: "item" }, [
        elemento("span", { class: "numero", texto: String(d.usos) }),
        elemento("span", { class: "corpo" }, [
          elemento("span", { class: "titulo", texto: d.nome }),
          elemento("span", { class: "detalhe", texto: `último uso em ${dataBR(d.ultimo_uso)}${custo}` }),
        ]),
      ]));
    }
    area.append(lista);
  }

  if (paradas.length) {
    area.append(elemento("h3", { style: "margin-top:18px", texto: "Ainda sem registro de uso" }));
    area.append(elemento("p", {
      class: "muted",
      texto: `${paradas.length} peça(s): ${paradas.slice(0, 6).map((d) => d.nome).join(", ")}${paradas.length > 6 ? "…" : ""}`,
    }));
  }
}

/* Canal direto com quem construiu o app. Num piloto com amigas, é o que
   transforma "achei estranho" em algo que dá para consertar. */
$("enviar-sugestao").onclick = () => {
  $("simples-titulo").textContent = "Mandar minha opinião";
  const form = elemento("form", {});
  form.innerHTML = `
    <label>Sobre o quê?<select name="assunto"></select></label>
    <label>Conta para a gente
      <textarea name="texto" rows="5" maxlength="1500" required
        placeholder="Ex.: cadastrar peça deu trabalho; senti falta de..."></textarea>
    </label>
    <small>Sua mensagem vai junto com a tela em que você estava. Nenhuma foto é enviada.</small>
    <button type="submit" class="largo" style="margin-top:16px">Enviar</button>
  `;
  form.assunto.replaceChildren(
    new Option("Algo não funcionou", "problema"),
    new Option("Ficou difícil de usar", "dificuldade"),
    new Option("Senti falta de alguma coisa", "faltou"),
    new Option("As sugestões de look", "sugestoes"),
    new Option("Elogio ou outra coisa", "outro"),
  );

  form.onsubmit = async (e) => {
    e.preventDefault();
    const botao = form.querySelector("button");
    botao.disabled = true;
    try {
      const { data: sessao } = await sb.auth.getUser();
      const { error } = await sb.from("vesty_eventos").insert({
        dona_id: sessao.user.id,
        tipo: "opiniao",
        dados: {
          assunto: form.assunto.value,
          texto: form.texto.value.trim(),
          aba: estado.aba,
          pecas: estado.total,
          tela: `${window.innerWidth}x${window.innerHeight}`,
        },
      });
      if (error) throw new Error(error.message);
      $("dialogo-simples").close();
      recado("Recebido. Obrigada de verdade!");
    } catch (erro) {
      recado(erro.message, "erro");
    } finally {
      botao.disabled = false;
    }
  };

  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
};

$("exportar").onclick = async () => {
  const { data, error } = await sb.rpc("vesty_exportar");
  if (error) { recado(error.message, "erro"); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vesty-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  recado("Arquivo gerado.");
};

$("ir-perfil").onclick = async () => {
  $("simples-titulo").textContent = "Meu perfil";
  const form = elemento("form", {});

  const CORES = ["Rosa", "Vermelho", "Laranja", "Amarelo", "Verde", "Azul", "Roxo", "Marrom", "Cinza", "Preto", "Branco", "Bege"];
  const TIPOS_ROUPA = ["Camisetas", "Blusas", "Camisas", "Vestidos", "Calças", "Shorts", "Saias", "Jaquetas", "Casacos", "Suéteres", "Leggings", "Jeans"];
  const ESTILOS = ["Casual", "Clássico", "Esportivo", "Elegante", "Boho", "Romântico", "Gótico", "Minimalista", "Vintage", "Moderno", "Feminino", "Masculino"];
  const COMPRIMENTO_CABELO = ["Muito curto", "Curto", "Médio", "Longo", "Muito longo"];
  const TOM_PELE = ["Muito claro", "Claro", "Médio", "Escuro", "Muito escuro"];
  const ORCAMENTO = ["Até R$ 50", "R$ 50-100", "R$ 100-200", "R$ 200-500", "Acima de R$ 500"];

  const perfil = estado.perfil || {};
  const coresSelecionadas = (perfil.cores_favoritas || "").split(",").filter(Boolean);
  const tiposSelecionados = (perfil.tipos_roupa || "").split(",").filter(Boolean);
  const estilosSelecionados = (perfil.estilos || "").split(",").filter(Boolean);

  form.innerHTML = `
    <div style="max-height:70vh; overflow-y:auto; padding-right:8px">
      <h3 style="margin:0 0 14px 0; font-size:16px; color:var(--ameixa)">Informações básicas</h3>
      <label>Nome completo<input name="nome" maxlength="120" required></label>
      <label>Gênero<input name="sexo" maxlength="30" readonly></label>
      <label>Idade<input name="idade" type="number" readonly></label>
      <label>Cidade<input name="cidade" maxlength="80" placeholder="Para a previsão do tempo"></label>

      <h3 style="margin:20px 0 14px 0; font-size:16px; color:var(--ameixa)">Suas preferências</h3>

      <label style="display:block; margin-bottom:8px; font-size:13px">Cores favoritas</label>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:16px" id="cores-chips"></div>

      <label style="display:block; margin-bottom:8px; font-size:13px">Tipos de roupa que mais usa</label>
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:16px" id="tipos-chips"></div>

      <label style="display:block; margin-bottom:8px; font-size:13px">Estilos que te atraem</label>
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:16px" id="estilos-chips"></div>

      <label>Comprimento de cabelo
        <select name="cabelo">
          <option value="">Selecione...</option>
          ${COMPRIMENTO_CABELO.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </label>

      <label>Tom de pele
        <select name="tom_pele">
          <option value="">Selecione...</option>
          ${TOM_PELE.map(t => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </label>

      <label>Orçamento médio por peça
        <select name="orcamento">
          <option value="">Selecione...</option>
          ${ORCAMENTO.map(o => `<option value="${o}">${o}</option>`).join("")}
        </select>
      </label>

      <label>Algo mais que você gostaria de nos contar?
        <textarea name="notas" maxlength="500" placeholder="Preferências, restrições, inspirações..."></textarea>
      </label>

      <small style="color:var(--suave); display:block; margin-top:12px">Suas informações ficam privadas e ajudam a personalizar os looks sugeridos. Você pode atualizar quando quiser.</small>
    </div>
    <button type="submit" class="largo" style="margin-top:16px">Salvar perfil</button>
  `;

  form.nome.value = perfil?.nome || "";
  form.sexo.value = perfil?.sexo || "";
  form.idade.value = perfil?.idade || "";
  form.cidade.value = perfil?.cidade || "";
  form.cabelo.value = perfil?.comprimento_cabelo || "";
  form.tom_pele.value = perfil?.tom_pele || "";
  form.orcamento.value = perfil?.orcamento || "";
  form.notas.value = perfil?.notas || "";

  const coresDiv = form.querySelector("#cores-chips");
  CORES.forEach(cor => {
    const chip = elemento("button", { type: "button", class: "chip-toggle" });
    chip.textContent = cor;
    if (coresSelecionadas.includes(cor)) chip.classList.add("ativo");
    chip.onclick = (e) => { e.preventDefault(); chip.classList.toggle("ativo"); };
    coresDiv.append(chip);
  });

  const tiposDiv = form.querySelector("#tipos-chips");
  TIPOS_ROUPA.forEach(tipo => {
    const chip = elemento("button", { type: "button", class: "chip-toggle" });
    chip.textContent = tipo;
    if (tiposSelecionados.includes(tipo)) chip.classList.add("ativo");
    chip.onclick = (e) => { e.preventDefault(); chip.classList.toggle("ativo"); };
    tiposDiv.append(chip);
  });

  const estilosDiv = form.querySelector("#estilos-chips");
  ESTILOS.forEach(estilo => {
    const chip = elemento("button", { type: "button", class: "chip-toggle" });
    chip.textContent = estilo;
    if (estilosSelecionados.includes(estilo)) chip.classList.add("ativo");
    chip.onclick = (e) => { e.preventDefault(); chip.classList.toggle("ativo"); };
    estilosDiv.append(chip);
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.nome.value.trim()) { recado("Informe seu nome", "atencao"); return; }

    const { data: sessao } = await sb.auth.getUser();
    const coresAtivas = Array.from(form.querySelector("#cores-chips").querySelectorAll(".ativo")).map(el => el.textContent).join(",");
    const tiposAtivos = Array.from(form.querySelector("#tipos-chips").querySelectorAll(".ativo")).map(el => el.textContent).join(",");
    const estilosAtivos = Array.from(form.querySelector("#estilos-chips").querySelectorAll(".ativo")).map(el => el.textContent).join(",");

    const valores = {
      nome: form.nome.value.trim(),
      cidade: form.cidade.value.trim(),
      cores_favoritas: coresAtivas,
      tipos_roupa: tiposAtivos,
      estilos: estilosAtivos,
      comprimento_cabelo: form.cabelo.value,
      tom_pele: form.tom_pele.value,
      orcamento: form.orcamento.value,
      notas: form.notas.value.trim(),
    };

    const { error } = await sb.from("vesty_perfis").update(valores).eq("id", sessao.user.id);
    if (error) { recado(error.message, "erro"); return; }
    Object.assign(estado.perfil, valores);
    atualizarSaudacao();
    $("dialogo-simples").close();
    atualizarClima();
    recado("Perfil atualizado com sucesso!");
  };

  $("simples-corpo").replaceChildren(form);
  $("dialogo-simples").showModal();
};

/* ============ partida ============ */

sb.auth.getSession().then(({ data }) => {
  if (data?.session) iniciarSessao();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
