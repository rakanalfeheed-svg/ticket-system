const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "tickets.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL
      CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'working', 'closed')),
    created_at TEXT NOT NULL
  );
`);

const getTickets = db.prepare(
  "SELECT * FROM tickets ORDER BY id DESC"
);

const insertTicket = db.prepare(`
  INSERT INTO tickets
    (customer, title, description, priority, status, created_at)
  VALUES (?, ?, ?, ?, 'new', ?)
`);

const getTicket = db.prepare(
  "SELECT * FROM tickets WHERE id = ?"
);

const updateStatus = db.prepare(
  "UPDATE tickets SET status = ? WHERE id = ?"
);

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

async function readJSON(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 64 * 1024) {
      const error = new Error("حجم الطلب أكبر من المسموح.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("بيانات الطلب غير صحيحة.");
    error.statusCode = 400;
    throw error;
  }
}

function validText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        const pathname = url.pathname;

        // عرض الصفحة الرئيسية.
        if (req.method === "GET" &&
            (pathname === "/" || pathname === "/index.html")) {
            const page = fs.readFileSync(
                path.join(__dirname, "public", "index.html")
            );

            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8"
            });

            res.end(page);
            return;
        }

        // جلب التذاكر من قاعدة البيانات.
        if (req.method === "GET" && pathname === "/api/tickets") {
            sendJSON(res, 200, getTickets.all());
            return;
        }

        // إنشاء تذكرة جديدة.
        if (req.method === "POST" && pathname === "/api/tickets") {
            const body = await readJSON(req);

            if (!body ||
                !validText(body.customer, 80) ||
                !validText(body.title, 120) ||
                !validText(body.description, 3000) ||
                !["low", "medium", "high"].includes(body.priority)) {
                sendJSON(res, 400, {
                    error: "يرجى إدخال بيانات صحيحة لجميع الحقول."
                });
                return;
            }

            // معاملات SQL تمنع دمج إدخال المستخدم في نص الاستعلام.
            const result = insertTicket.run(
                body.customer.trim(),
                body.title.trim(),
                body.description.trim(),
                body.priority,
                new Date().toISOString()
            );

            const ticket = getTicket.get(Number(result.lastInsertRowid));
            sendJSON(res, 201, ticket);
            return;
        }

        // تغيير حالة تذكرة.
        const match = pathname.match(/^\/api\/tickets\/(\d+)$/);

        if (req.method === "PATCH" && match) {
            const id = Number(match[1]);

            if (!Number.isSafeInteger(id) || id < 1) {
                sendJSON(res, 400, { error: "رقم التذكرة غير صحيح." });
                return;
            }

            const body = await readJSON(req);

            if (!body || !["new", "working", "closed"].includes(body.status)) {
                sendJSON(res, 400, { error: "حالة التذكرة غير صحيحة." });
                return;
            }

            if (!getTicket.get(id)) {
                sendJSON(res, 404, { error: "التذكرة غير موجودة." });
                return;
            }

            updateStatus.run(body.status, id);
            sendJSON(res, 200, getTicket.get(id));
            return;
        }

        sendJSON(res, 404, { error: "المسار غير موجود." });
    } catch (error) {
        console.error(error);

        sendJSON(res, error.statusCode || 500, {
            error: error.statusCode
                ? error.message
                : "حدث خطأ في الخادم."
        });
    }
});

// تشغيل محلي فقط.
server.listen(3000, "127.0.0.1", () => {
  console.log("افتح التطبيق: http://127.0.0.1:3000");
});