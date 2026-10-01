const clientsByUserId = new Map();

function toInt(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function subscribeUser(userId, res, sessionId = null) {
  const uid = toInt(userId);
  if (!uid || !res) {
    return () => {};
  }
  // Lets endSessionStreams() find the connections of one sign-in session.
  res.ciacSessionId = sessionId || null;

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

function publishToUser(userId, payload, eventName = "notification") {
  const uid = toInt(userId);
  if (!uid) return;
  const clients = clientsByUserId.get(uid);
  if (!clients || clients.size === 0) return;
  for (const res of clients) {
    writeEvent(res, eventName, payload || {});
  }
}

/** Tells the open pages of the given sessions that they were signed out
 * (a newer sign-in replaced them), then closes those connections. */
function endSessionStreams(userId, sessionIds, reason = "replaced") {
  const clients = clientsByUserId.get(toInt(userId));
  if (!clients || !sessionIds?.length) return;
  for (const res of Array.from(clients)) {
    if (!res.ciacSessionId || !sessionIds.includes(res.ciacSessionId)) continue;
    writeEvent(res, "session-ended", { reason });
    try {
      res.end();
    } catch {
      // already closed
    }
  }
}

function publishToUsers(userIds, payload, eventName = "notification") {
  const uniqueIds = Array.from(new Set((Array.isArray(userIds) ? userIds : []).map((value) => toInt(value)).filter(Boolean)));
  for (const uid of uniqueIds) {
    publishToUser(uid, payload, eventName);
  }
}

/** Every open page of every signed-in user (e.g. "portal settings changed,
 * re-fetch them"). The payload must be safe for anyone to see. */
function publishToAll(payload, eventName) {
  for (const clients of clientsByUserId.values()) {
    for (const res of clients) writeEvent(res, eventName, payload || {});
  }
}

module.exports = {
  subscribeUser,
  writeEvent,
  publishToUser,
  publishToUsers,
  publishToAll,
  endSessionStreams,
};
