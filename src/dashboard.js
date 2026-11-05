import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  child,
  get,
  onValue,
  push,
  ref as databaseRef,
  remove,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { auth, db, isFirebaseConfigured, storage } from "./firebase.js";

const logoutButton = document.querySelector("#logout-button");
const accountEmail = document.querySelector("#account-email");
const accountButton = document.querySelector("#account-button");
const accountDialog = document.querySelector("#account-dialog");
const accountCloseButton = document.querySelector("#account-close");
const accountStatus = document.querySelector("#account-status");
const accountDetails = document.querySelector("#account-details");
const analysisForm = document.querySelector("#analysis-form");
const analysisStatus = document.querySelector("#analysis-input-status");
const historyStatus = document.querySelector("#history-status");
const historyList = document.querySelector("#conversation-list");
const newConversationButton = document.querySelector("#new-conversation");
const conversationTitle = document.querySelector("#conversation-title");
const conversationThread = document.querySelector("#conversation-thread");
const conversationEmpty = document.querySelector("#conversation-empty");
const textInput = document.querySelector("#analysis-text");
const urlInput = document.querySelector("#analysis-url");
const pdfInput = document.querySelector("#analysis-pdf");
const selectedFile = document.querySelector("#selected-file");
const fileName = document.querySelector("#file-name");
const analyzeButton = document.querySelector("#analyze-button");
const sourceTabs = [...document.querySelectorAll(".source-tab")];
let activeSource = "text";
let currentUser = null;
let currentConversationId = null;
let conversations = {};
let stopWatchingConversations = null;

function showStatus(element, message, kind = "error") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function firebaseErrorMessage(error) {
  const messages = {
    PERMISSION_DENIED: "Firebase rechazó el acceso. Revisa las reglas de Realtime Database y Firebase Storage.",
    "storage/unauthorized": "Firebase Storage rechazó el acceso. Revisa sus reglas de seguridad.",
    "storage/bucket-not-found": "No se encontró el bucket de Firebase Storage. Confirma la configuración y habilítalo en Firebase.",
    "storage/quota-exceeded": "Se alcanzó la cuota de almacenamiento de Firebase.",
    "storage/canceled": "La operación con el archivo fue cancelada.",
    "database/permission-denied": "Realtime Database rechazó el acceso. Revisa sus reglas de seguridad.",
  };
  return messages[error.code] ?? `No se pudo completar la operación: ${error.message}`;
}

function formatAccountDate(timestamp) {
  if (typeof timestamp !== "number") return "No disponible";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

async function showAccountProfile() {
  accountDialog.showModal();
  accountDetails.hidden = true;
  accountStatus.textContent = "Cargando los datos de tu cuenta…";
  accountStatus.dataset.kind = "loading";
  accountButton.disabled = true;

  try {
    const snapshot = await get(databaseRef(db, `usuarios/${currentUser.uid}`));
    const profile = snapshot.val();
    if (!profile) {
      accountStatus.textContent = "No encontramos un perfil guardado para esta cuenta.";
      accountStatus.dataset.kind = "error";
      return;
    }

    const fields = {
      "account-name": profile.nombre_completo,
      "account-type": profile.tipo_usuario,
      "account-enrollment": profile.matricula,
      "account-level": profile.nivel_estudios,
      "account-area": profile.area_ensenanza,
      "account-profile-email": profile.correo || currentUser.email,
      "account-registered": formatAccountDate(profile.fecha_registro),
    };
    for (const [id, value] of Object.entries(fields)) {
      document.querySelector(`#${id}`).textContent = value || "No disponible";
    }
    accountDetails.hidden = false;
    accountStatus.textContent = "";
  } catch (error) {
    accountStatus.textContent = firebaseErrorMessage(error);
    accountStatus.dataset.kind = "error";
  } finally {
    accountButton.disabled = false;
  }
}

function clearConversationView() {
  conversationTitle.textContent = "Nueva conversación";
  conversationThread.replaceChildren(conversationEmpty);
  conversationEmpty.hidden = false;
  renderConversationList();
}

function formatDate(timestamp) {
  if (typeof timestamp !== "number") return "Guardando…";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function renderConversationList() {
  historyList.replaceChildren();
  const entries = Object.entries(conversations).sort(
    ([, first], [, second]) => (second.actualizadaEn ?? 0) - (first.actualizadaEn ?? 0),
  );

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Tus conversaciones guardadas aparecerán aquí.";
    historyList.append(empty);
    return;
  }

  for (const [id, conversation] of entries) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.classList.toggle("is-selected", id === currentConversationId);

    const select = document.createElement("button");
    select.className = "conversation-select";
    select.type = "button";
    select.addEventListener("click", () => {
      currentConversationId = id;
      renderConversation(conversation);
      renderConversationList();
      showStatus(historyStatus, "");
    });

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = conversation.titulo || "Nueva conversación";

    const date = document.createElement("span");
    date.className = "history-item-date";
    date.textContent = formatDate(conversation.actualizadaEn);
    select.append(title, date);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-conversation";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Eliminar conversación: ${conversation.titulo || "Sin título"}`);
    deleteButton.title = "Eliminar conversación";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => deleteConversation(id));

    item.append(select, deleteButton);
    historyList.append(item);
  }
}

function getAnswerVerdict(answer) {
  const plainAnswer = answer.replace(/[*#_`]/g, "").trim();
  const choices = "NO VERIFICABLE|PARCIALMENTE RESPALDAD[AO]|REFUTAD[AO]|FALS[AO]|RESPALDAD[AO]|VERDADER[AO]";
  const match = plainAnswer.match(new RegExp(`\\bVEREDICTO\\s*:\\s*(${choices})\\b`, "i"))
    || plainAnswer.split("\n").find((line) => line.trim())?.match(new RegExp(`^\\s*(${choices})\\b`, "i"));
  const verdict = match?.[1]?.toLocaleUpperCase("es-MX");
  if (verdict === "REFUTADA" || verdict === "REFUTADO" || verdict === "FALSA" || verdict === "FALSO") {
    return { label: "Falso", kind: "false" };
  }
  if (verdict === "RESPALDADA" || verdict === "RESPALDADO" || verdict === "VERDADERA" || verdict === "VERDADERO") {
    return { label: "Verdadero", kind: "true" };
  }
  return { label: "No se sabe con certeza", kind: "uncertain" };
}

function cleanAnswerFormatting(line) {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function renderFormattedAnswer(answer, content) {
  const verdict = getAnswerVerdict(answer);
  const indicator = document.createElement("div");
  indicator.className = `answer-verdict answer-verdict-${verdict.kind}`;
  indicator.setAttribute("role", "status");
  const symbol = document.createElement("span");
  symbol.className = "answer-verdict-symbol";
  symbol.setAttribute("aria-hidden", "true");
  const label = document.createElement("strong");
  label.textContent = verdict.label;
  indicator.append(symbol, label);
  content.append(indicator);

  const body = document.createElement("div");
  body.className = "answer-body";
  const lines = answer.replace(/\r\n?/g, "\n").split("\n");
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = document.createElement("p");
    text.textContent = paragraph.join(" ");
    body.append(text);
    paragraph = [];
  };

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (index === 0 && /^VEREDICTO\s*:/i.test(cleanAnswerFormatting(line))) continue;
    if (!line || /^[-*_]{3,}$/.test(line)) {
      flushParagraph();
      continue;
    }

    if (/^\|.*\|$/.test(line)) {
      flushParagraph();
      const cells = line.split("|").slice(1, -1).map(cleanAnswerFormatting);
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (cells.length === 2 && /fuente/i.test(cells[0]) && /evidencia/i.test(cells[1])) continue;
      if (cells.length >= 2) {
        const evidence = document.createElement("div");
        evidence.className = "answer-evidence";
        const source = document.createElement("strong");
        source.textContent = cells[0];
        const description = document.createElement("p");
        description.textContent = cells.slice(1).join(" — ");
        evidence.append(source, description);
        body.append(evidence);
      } else if (cells[0]) {
        const text = document.createElement("p");
        text.textContent = cells[0];
        body.append(text);
      }
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/) || line.match(/^\*\*(.+)\*\*$/);
    const sectionMatch = line.match(/^(Resumen|Evidencia|Conclusión|Limitaciones|Análisis)(?:\s*:\s*(.*))?$/i);
    if (headingMatch || sectionMatch) {
      flushParagraph();
      const heading = document.createElement("h3");
      heading.textContent = cleanAnswerFormatting(headingMatch?.[1] || sectionMatch[1]);
      body.append(heading);
      const sectionText = sectionMatch?.[2];
      if (sectionText) {
        const text = document.createElement("p");
        text.textContent = cleanAnswerFormatting(sectionText);
        body.append(text);
      }
      continue;
    }

    const listMatch = line.match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/);
    if (listMatch) {
      flushParagraph();
      const item = document.createElement("p");
      item.textContent = cleanAnswerFormatting(listMatch[1]);
      body.append(item);
    } else {
      paragraph.push(cleanAnswerFormatting(line));
    }
  }
  flushParagraph();
  content.append(body);
}

async function renderMessage(messageId, message) {
  const article = document.createElement("article");
  article.className = message.tipo === "respuesta"
    ? "chat-message chat-message-assistant"
    : "chat-message";

  const heading = document.createElement("div");
  heading.className = "chat-message-heading";
  const label = document.createElement("span");
  label.className = "message-type";
  label.textContent = message.tipo === "respuesta"
    ? `Respuesta · ${message.proveedor || "IA"}`
    : message.tipo === "pdf" ? "Documento PDF" : message.tipo === "url" ? "Enlace" : "Texto";
  const date = document.createElement("time");
  date.className = "message-date";
  date.textContent = formatDate(message.creadoEn);
  heading.append(label, date);

  const content = document.createElement("div");
  content.className = "chat-message-content";

  if (message.tipo === "respuesta") {
    renderFormattedAnswer(message.contenido, content);

    let sources = [];
    try {
      sources = JSON.parse(message.fuentes || "[]");
    } catch {
      sources = [];
    }

    if (message.proveedor === "Groq") {
      const notice = document.createElement("p");
      notice.className = "message-source-note";
      notice.textContent = Array.isArray(sources) && sources.length > 0
        ? "Análisis de Groq basado en fuentes web confiables."
        : "No se encontraron fuentes confiables para respaldar esta respuesta.";
      content.append(notice);
    }

    if (Array.isArray(sources) && sources.length > 0) {
      const sourceHeading = document.createElement("p");
      sourceHeading.className = "message-sources-heading";
      sourceHeading.textContent = "Fuentes consultadas";
      const list = document.createElement("ol");
      list.className = "message-sources";
      for (const source of sources) {
        if (typeof source?.url !== "string") continue;
        try {
          if (new URL(source.url).protocol !== "https:") continue;
        } catch {
          continue;
        }
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || source.url;
        item.append(link);
        list.append(item);
      }
      if (list.childElementCount > 0) content.append(sourceHeading, list);
    }
  } else if (message.tipo === "pdf") {
    const name = document.createElement("span");
    name.className = "message-file-name";
    name.textContent = message.archivoNombre || message.contenido;
    const link = document.createElement("a");
    link.className = "message-file-link";
    link.textContent = "Abrir PDF ↗";
    link.href = "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    content.append(name, link);
    try {
      link.href = await getDownloadURL(storageRef(storage, message.archivoRuta));
    } catch (error) {
      link.removeAttribute("target");
      link.removeAttribute("href");
      link.textContent = firebaseErrorMessage(error);
    }
  } else if (message.tipo === "url") {
    let safeUrl = false;
    try {
      safeUrl = new URL(message.contenido).protocol === "https:";
    } catch {
      safeUrl = false;
    }
    if (safeUrl) {
      const link = document.createElement("a");
      link.className = "message-url";
      link.href = message.contenido;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = message.contenido;
      content.append(link);
    } else {
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = message.contenido;
      content.append(text);
    }
  } else {
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = message.contenido;
    content.append(text);
  }

  article.append(heading, content);
  article.dataset.messageId = messageId;
  conversationThread.append(article);
}

function renderConversation(conversation) {
  conversationTitle.textContent = conversation.titulo || "Conversación";
  conversationThread.replaceChildren();
  const messages = Object.entries(conversation.mensajes ?? {}).sort(
    ([, first], [, second]) => (first.creadoEn ?? 0) - (second.creadoEn ?? 0),
  );

  if (messages.length === 0) {
    conversationThread.append(conversationEmpty);
    conversationEmpty.hidden = false;
    return;
  }

  conversationEmpty.hidden = true;
  for (const [id, message] of messages) {
    void renderMessage(id, message);
  }
}

function fileNameForTitle(name) {
  return name.length > 72 ? `${name.slice(0, 69)}…` : name;
}

function titleForMessage(message) {
  if (message.tipo === "pdf") return fileNameForTitle(message.archivoNombre);
  const compact = message.contenido.replace(/\s+/g, " ").trim();
  if (message.tipo === "url") {
    try {
      return new URL(compact).hostname;
    } catch {
      return fileNameForTitle(compact);
    }
  }
  return fileNameForTitle(compact);
}

async function deleteStorageFolder(folder) {
  const contents = await listAll(folder);
  await Promise.all(contents.items.map((item) => deleteObject(item)));
  await Promise.all(contents.prefixes.map((prefix) => deleteStorageFolder(prefix)));
}

async function deleteConversation(id) {
  const conversation = conversations[id];
  if (!conversation || !window.confirm(`¿Eliminar la conversación "${conversation.titulo}" y sus archivos PDF guardados?`)) {
    return;
  }

  showStatus(historyStatus, "Eliminando conversación y archivos…", "loading");
  try {
    const hasFiles = Object.values(conversation.mensajes ?? {}).some((message) => message.tipo === "pdf");
    if (hasFiles) {
      await deleteStorageFolder(storageRef(storage, `conversaciones/${currentUser.uid}/${id}`));
    }
    await remove(databaseRef(db, `conversaciones/${currentUser.uid}/${id}`));
    if (currentConversationId === id) {
      currentConversationId = null;
      clearConversationView();
    }
    showStatus(historyStatus, "Conversación eliminada.", "success");
  } catch (error) {
    showStatus(historyStatus, firebaseErrorMessage(error));
  }
}

function startWatchingConversations(user) {
  stopWatchingConversations?.();
  const conversationsRef = databaseRef(db, `conversaciones/${user.uid}`);
  stopWatchingConversations = onValue(
    conversationsRef,
    (snapshot) => {
      conversations = snapshot.val() ?? {};
      if (currentConversationId && !conversations[currentConversationId]) {
        currentConversationId = null;
        clearConversationView();
      } else if (currentConversationId && conversations[currentConversationId]) {
        renderConversation(conversations[currentConversationId]);
      }
      renderConversationList();
    },
    (error) => showStatus(historyStatus, firebaseErrorMessage(error)),
  );
}

if (!isFirebaseConfigured || !auth || !db || !storage) {
  window.location.replace("/login.html");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      stopWatchingConversations?.();
      window.location.replace("/login.html");
      return;
    }
    currentUser = user;
    accountEmail.textContent = user.email ?? "";
    startWatchingConversations(user);
  });
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut(auth);
    window.location.replace("/login.html");
  } catch (error) {
    showStatus(analysisStatus, `No se pudo cerrar la sesión: ${error.message}`);
    logoutButton.disabled = false;
  }
});

accountButton.addEventListener("click", () => {
  if (currentUser) void showAccountProfile();
});

accountCloseButton.addEventListener("click", () => accountDialog.close());
accountDialog.addEventListener("click", (event) => {
  if (event.target === accountDialog) accountDialog.close();
});

newConversationButton.addEventListener("click", () => {
  currentConversationId = null;
  clearConversationView();
  showStatus(historyStatus, "");
  showStatus(analysisStatus, "");
  analysisForm.reset();
  document.querySelector("#text-count").textContent = "0 / 12,000";
  clearSelectedFile();
  setSource("text");
  textInput.focus();
});

function setSource(source) {
  activeSource = source;
  for (const tab of sourceTabs) {
    const isActive = tab.dataset.source === source;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    document.querySelector(`#panel-${tab.dataset.source}`).hidden = !isActive;
  }
  analysisStatus.textContent = "";
}

for (const tab of sourceTabs) {
  tab.addEventListener("click", () => setSource(tab.dataset.source));
}

textInput.addEventListener("input", () => {
  document.querySelector("#text-count").textContent =
    `${textInput.value.length.toLocaleString("es-MX")} / 12,000`;
});

function clearSelectedFile() {
  pdfInput.value = "";
  selectedFile.hidden = true;
  fileName.textContent = "";
}

pdfInput.addEventListener("change", () => {
  const [file] = pdfInput.files ?? [];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    clearSelectedFile();
    showStatus(analysisStatus, "Selecciona un archivo PDF válido.");
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    clearSelectedFile();
    showStatus(analysisStatus, "El PDF supera el límite de 15 MB.");
    return;
  }

  showStatus(analysisStatus, "");
  fileName.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  selectedFile.hidden = false;
});

document.querySelector("#remove-file").addEventListener("click", clearSelectedFile);

const dropzone = document.querySelector("#pdf-dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}
dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  pdfInput.files = transfer.files;
  pdfInput.dispatchEvent(new Event("change", { bubbles: true }));
});

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function requestAnalysis(message, file) {
  const token = await currentUser.getIdToken();
  const payload = {
    type: message.tipo,
    content: message.contenido,
  };
  if (file) {
    payload.fileName = file.name;
    payload.fileData = await encodeFile(file);
  }

  const response = await fetch("/api/verify", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("No se pudo conectar con el servicio de verificación. Comprueba que npm run dev siga activo.");
  }
  if (!response.ok) throw new Error(result.error || "No se pudo completar el análisis.");
  if (typeof result.answer !== "string" || result.provider !== "Groq") {
    throw new Error("El servicio devolvió una respuesta con formato no válido.");
  }
  return result;
}

analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const [file] = pdfInput.files ?? [];
  const content =
    activeSource === "text"
      ? textInput.value.trim()
      : activeSource === "url"
        ? urlInput.value.trim()
        : file?.name ?? "";
  const validContent =
    activeSource === "text"
      ? content.length > 0
      : activeSource === "url"
        ? urlInput.validity.valid && content.length > 0 && content.length <= 2048
        : Boolean(file);

  if (!validContent) {
    showStatus(
      analysisStatus,
      activeSource === "text"
        ? "Escribe el texto que quieres guardar."
        : activeSource === "url"
          ? "Escribe una URL válida (máximo 2,048 caracteres)."
          : "Selecciona un archivo PDF para guardar.",
    );
    return;
  }

  if (!currentUser) {
    showStatus(analysisStatus, "Tu sesión ya no está activa. Inicia sesión de nuevo.");
    return;
  }

  analyzeButton.disabled = true;
  showStatus(
    analysisStatus,
    file ? "Subiendo el PDF de forma privada…" : "Guardando y preparando la verificación…",
    "loading",
  );

  let uploadedFileRef = null;
  let fileUploaded = false;
  try {
    const userConversationsRef = databaseRef(db, `conversaciones/${currentUser.uid}`);
    const conversationRef = currentConversationId
      ? databaseRef(db, `conversaciones/${currentUser.uid}/${currentConversationId}`)
      : push(userConversationsRef);
    const conversationId = conversationRef.key;
    const messagesRef = child(conversationRef, "mensajes");
    const messageRef = push(messagesRef);
    const messageId = messageRef.key;
    const message = {
      tipo: activeSource === "text" ? "texto" : activeSource,
      contenido: content,
      creadoEn: serverTimestamp(),
    };

    if (file) {
      const path = `conversaciones/${currentUser.uid}/${conversationId}/${messageId}/documento.pdf`;
      uploadedFileRef = storageRef(storage, path);
      await uploadBytes(uploadedFileRef, file, { contentType: "application/pdf" });
      fileUploaded = true;
      message.archivoNombre = file.name;
      message.archivoRuta = path;
    }

    const existing = currentConversationId ? conversations[currentConversationId] : null;
    if (existing) {
      await update(conversationRef, {
        [`mensajes/${messageId}`]: message,
        actualizadaEn: serverTimestamp(),
      });
    } else {
      await set(conversationRef, {
        titulo: titleForMessage(message),
        creadaEn: serverTimestamp(),
        actualizadaEn: serverTimestamp(),
        mensajes: { [messageId]: message },
      });
    }

    currentConversationId = conversationId;
    const savedSnapshot = await get(conversationRef);
    const savedConversation = savedSnapshot.val();
    if (!savedConversation) {
      throw new Error("No se pudo volver a cargar la conversación guardada.");
    }
    conversations[conversationId] = savedConversation;
    renderConversation(savedConversation);
    renderConversationList();
    analysisForm.reset();
    document.querySelector("#text-count").textContent = "0 / 12,000";
    clearSelectedFile();
    setSource("text");
    showStatus(
      analysisStatus,
      file
        ? "Groq está leyendo el PDF y buscando fuentes confiables…"
        : "Groq está buscando fuentes confiables…",
      "loading",
    );

    try {
      const result = await requestAnalysis(message, file);
      const responseMessageRef = push(messagesRef);
      const responseMessage = {
        tipo: "respuesta",
        contenido: result.answer,
        proveedor: result.provider,
        fuentes: JSON.stringify(Array.isArray(result.sources) ? result.sources.slice(0, 6) : []),
        creadoEn: serverTimestamp(),
      };
      await update(conversationRef, {
        [`mensajes/${responseMessageRef.key}`]: responseMessage,
        actualizadaEn: serverTimestamp(),
      });
      const updatedSnapshot = await get(conversationRef);
      const updatedConversation = updatedSnapshot.val();
      if (!updatedConversation) {
        throw new Error("La respuesta se generó, pero no se pudo volver a cargar la conversación.");
      }
      conversations[conversationId] = updatedConversation;
      if (currentConversationId === conversationId) renderConversation(updatedConversation);
      renderConversationList();
      showStatus(
        analysisStatus,
        result.sources.length > 0
          ? "Análisis guardado con Groq y fuentes web confiables."
          : "Análisis guardado; no se encontraron fuentes confiables suficientes.",
        "success",
      );
    } catch (error) {
      showStatus(
        analysisStatus,
        `El contenido quedó guardado, pero no se pudo completar o guardar la respuesta de IA: ${error.message}`,
      );
    }
  } catch (error) {
    if (uploadedFileRef && fileUploaded) {
      try {
        await deleteObject(uploadedFileRef);
      } catch (cleanupError) {
        showStatus(
          analysisStatus,
          `No se pudo guardar en el historial (${error.message}) ni limpiar el archivo temporal (${cleanupError.message}).`,
        );
        analyzeButton.disabled = false;
        return;
      }
    }
    showStatus(analysisStatus, firebaseErrorMessage(error));
  } finally {
    analyzeButton.disabled = false;
  }
});
