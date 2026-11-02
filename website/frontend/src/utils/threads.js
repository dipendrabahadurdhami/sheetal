// Conversations with agencies, kept in the browser for now;
// every message is also sent to the agency via contact-agent.
const KEY = "sheetal_threads";
export const listThreads = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (t) => { localStorage.setItem(KEY, JSON.stringify(t)); window.dispatchEvent(new Event("sheetal:threads")); };

export function addMessage({ agentId, agentName, agentPhoto, propertyId, propertyName, text }) {
  const all = listThreads();
  const id = `${agentId || "office"}-${propertyId || "general"}`;
  let t = all.find((x) => x.id === id);
  if (!t) { t = { id, agentId, agentName: agentName || "Sheetal Property", agentPhoto, propertyId, propertyName, messages: [] }; all.unshift(t); }
  t.messages.push({ me: true, text, at: new Date().toISOString() });
  if (t.messages.length === 1) t.messages.push({ me: false, text: "Thank you for your message. I will call you shortly with the details.", at: new Date(Date.now() + 1000).toISOString() });
  t.updated = new Date().toISOString();
  save(all.sort((a, b) => (b.updated || "").localeCompare(a.updated || "")));
  return t;
}
