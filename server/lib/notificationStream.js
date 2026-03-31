const clientsByUserId = new Map();

function toInt(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function subscribeUser(userId, res) {
  const uid = toInt(userId);
  if (!uid || !res) {
    return () => {};
  }

  let clients = clientsByUserId.get(uid);
  if (!clients) {
    clients = new Set();
    clientsByUserId.set(uid, clients);
  }

  clients.add(res);

  return () => {
    const activeClients = clientsByUserId.get(uid);
    if (!activeClients) return;
    activeClients.delete(res);
    if (activeClients.size === 0) {
      clientsByUserId.delete(uid);
    }
  };
}

function writeEvent(res, eventName, payload) {
  if (!res || res.writableEnded) return;
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
  } catch {
    // Ignore broken connections. Cleanup runs on request close.
  }
}

function publishToUser(userId, payload) {
  const uid = toInt(userId);
  if (!uid) return;
  const clients = clientsByUserId.get(uid);
  if (!clients || clients.size === 0) return;
  for (const res of clients) {
    writeEvent(res, "notification", payload || {});
  }
}

function publishToUsers(userIds, payload) {
  const uniqueIds = Array.from(new Set((Array.isArray(userIds) ? userIds : []).map((value) => toInt(value)).filter(Boolean)));
  for (const uid of uniqueIds) {
    publishToUser(uid, payload);
  }
}

module.exports = {
  subscribeUser,
  writeEvent,
  publishToUser,
  publishToUsers,
};
