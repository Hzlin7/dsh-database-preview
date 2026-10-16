/**
 * Generate the sample SQLite database used to try the plugin out by hand.
 *
 * Run with `pnpm run sample`, then open `examples/shop.db` from the right
 * Sidebar's Files tab.
 * @module dsh-database-preview/examples/make-sample
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(join(here, 'shop.db'))
mkdirSync(here, { recursive: true })
rmSync(target, { force: true })

const db = new DatabaseSync(target)
db.exec(`
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    country TEXT DEFAULT 'CN',
    credit REAL,
    note BLOB,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX customers_email ON customers (email);
  CREATE INDEX customers_country ON customers (country);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers (id),
    placed_at TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'paid'
  );
  CREATE INDEX orders_customer ON orders (customer_id);

  CREATE VIEW recent_orders AS
    SELECT o.id, c.name AS customer, o.placed_at, o.total, o.status
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.placed_at >= '2026-01-01';
`)

const customers = [
  [1, 'Ada Lovelace', 'ada@example.com', 'GB', 1280.5, new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
  [2, 'Grace Hopper', 'grace@example.com', 'US', 940.25, null],
  [3, '林纳斯', 'linus@example.com', 'FI', 132.75, null],
  [4, 'Barbara Liskov', 'barbara@example.com', 'US', null, null],
]
const insertCustomer = db.prepare('INSERT INTO customers (id, name, email, country, credit, note) VALUES (?, ?, ?, ?, ?, ?)')
for (const row of customers) insertCustomer.run(...row)

const statuses = ['paid', 'shipped', 'refunded']
const insertOrder = db.prepare('INSERT INTO orders (id, customer_id, placed_at, total, status) VALUES (?, ?, ?, ?, ?)')
for (let index = 1; index <= 60; index += 1) {
  const customerId = ((index - 1) % customers.length) + 1
  const day = String((index % 28) + 1).padStart(2, '0')
  insertOrder.run(index, customerId, `2026-03-${day} 09:${String(index % 60).padStart(2, '0')}:00`, Number((index * 7.35).toFixed(2)), statuses[index % statuses.length])
}

// A value beyond Number.MAX_SAFE_INTEGER, so the grid's precision handling is visible.
db.exec('CREATE TABLE counters (id INTEGER PRIMARY KEY, label TEXT, value INTEGER)')
db.prepare('INSERT INTO counters (id, label, value) VALUES (?, ?, ?)').run(1, 'snowflake', 9223372036854775807n)

db.close()
console.log(`wrote ${target}`)
