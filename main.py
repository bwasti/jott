from flask import Flask, render_template, request, g, abort
import sqlite3
import time

app = Flask(__name__)

# Singleton pattern (because threading)
def get_db(name):
    if app.config["DEBUG"]:
        name = "{}_debug".format(name)
    db = getattr(g, "_database_{}".format(name), None)
    db_list = getattr(g, "_db_list", [])
    if db is None:
        db = g._database = sqlite3.connect("{}.db".format(name))
        db_list.append(name)
    return db


def get_ip():
    ip_forward = request.headers.getlist("X-Forwarded-For")
    if ip_forward:
        return ip_forward[0]
    else:
        return request.remote_addr


@app.route("/")
def index():
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM notes")
    count = c.fetchone()[0]
    return render_template("index.html", count=count)


def edit_impl(name, template):
    note = ""
    if name:
        conn = get_db("notes")
        c = conn.cursor()
        c.execute("SELECT note FROM notes WHERE name=?", (name,))
        result = c.fetchone()
        note = result[0] if result else ""
    return render_template(template, name=name, note=note)


@app.route("/edit/note/")
@app.route("/edit/note/<name>")
def edit_note(name=""):
    return edit_impl(name, "edit.html")


@app.route("/edit/texdown/")
@app.route("/edit/texdown/<name>")
def edit_texdown(name=""):
    return edit_impl(name, "edit_texdown.html")


# Used by both save_note and save_raw
def save_note_impl(name, note, key):
    if len(name) > 99 or len(name) < 1:
        return "Note name length must be between 1 and 100 characters\n", 403

    if len(key) > 99:
        return "Note key length must be under 100 characters\n", 403

    if len(note) > 10000:
        return "Note length must be under 10K characters\n", 403

    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT key FROM notes WHERE name=?", (name,))

    saved_key = c.fetchone()
    if saved_key and saved_key[0] != key:
        return "Note already saved with different key\n", 403

    ip = get_ip()
    date = int(time.time())

    c.execute(
        """
        SELECT count, date FROM ips WHERE ip=?
        """,
        (ip,),
    )
    count_lookup = c.fetchone()

    if count_lookup:
        time_since = date - count_lookup[1]
        count = count_lookup[0] + 1
        if time_since < 5:
            return "Rate limit reached. Please try again later.\n", 403
    else:
        count = 1
        c.execute(
            """
            INSERT INTO ips VALUES (?, ?, ?)
            """,
            (ip, count, date),
        )

    c.execute(
        """
        UPDATE ips SET count=?, date=? WHERE ip=?
        """,
        (count, date, ip),
    )

    c.execute(
        """
        DELETE FROM notes WHERE name=?
        """,
        (name,),
    )

    c.execute(
        """
        INSERT INTO notes VALUES (?, ?, ?, ?, ?)
        """,
        (name, note, key, ip, date),
    )

    conn.commit()
    return "https://jott.live/note/{}\n".format(name)


@app.route("/save/raw/<name>/", methods=["POST"])
@app.route("/save/raw/<name>/<key>", methods=["POST"])
def save_raw(name, key=""):
    note = request.form["note"]
    return save_note_impl(name, note, key)


@app.route("/save/note/<name>/", methods=["POST"])
@app.route("/save/note/<name>/<key>", methods=["POST"])
def save_note(name, key=""):
    note = request.json["note"]
    return save_note_impl(name, note, key)


@app.route("/delete/note/<name>/", methods=["GET"])
@app.route("/delete/note/<name>/<key>", methods=["GET"])
def delete_note(name, key=""):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT key FROM notes WHERE name=?", (name,))
    saved_key = c.fetchone()
    if saved_key and saved_key[0] != key:
        return "Incorrect key\n", 403
    c.execute(
        """
        DELETE FROM notes WHERE name=?
        """,
        (name,),
    )
    conn.commit()
    return 'Success! Note "{}" deleted\n'.format(name)


@app.route("/note/<name>")
def note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("render.html", name=name, note=note)


@app.route("/texdown/<name>")
@app.route("/texdown/note/<name>")
def texdown_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("texdown.html", name=name, note=note)


@app.route("/code/<name>")
@app.route("/code/note/<name>")
def code_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("code.html", name=name, note=note)


@app.route("/raw/<name>")
@app.route("/raw/note/<name>")
def raw_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return note


@app.before_request
def track():
    ip = get_ip()
    path = request.full_path
    if path[-1] == "?":
        path = path[:-1]

    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT count FROM visits WHERE ip=? AND path=?", (ip, path))
    result = c.fetchone()
    if result:
        count = result[0] + 1
    else:
        count = 1
        c.execute(
            """
            INSERT INTO visits VALUES (?, ?, ?)
            """,
            (ip, path, count),
        )

    c.execute(
        """
        UPDATE visits SET count=? WHERE ip=? AND path=?
        """,
        (count, ip, path),
    )
    conn.commit()


@app.route("/stats")
def stats():
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM ips")
    result = c.fetchone()
    author_count = result[0] if result else 0

    c.execute("SELECT COUNT(*) FROM notes")
    result = c.fetchone()
    note_count = result[0] if result else 0

    c.execute("SELECT COUNT(DISTINCT ip) FROM visits")
    result = c.fetchone()
    visit_count = result[0] if result else 0

    c.execute(
        """
        SELECT path, COUNT(DISTINCT ip) as sum
        FROM visits
        WHERE path NOT LIKE '/save/%'
        GROUP BY path
        ORDER BY sum DESC
        """
    )
    top_paths = []

    for i in range(5):
        result = c.fetchone()
        if result:
            top_paths.append(result)
    top_paths_str = "\n".join(
        ["{}: {}".format(path, count) for path, count in top_paths]
    )

    return "{} visitors\n{} notes\n{} authors\n{}\n".format(
        visit_count, note_count, author_count, top_paths_str
    )


@app.before_first_request
def initialize_dbs():
    db = get_db("notes")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (name text, note text, key text, author_ip text, date integer)
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS ips (ip text, count integer, date integer)
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS visits (ip text, path text, count integer)
        """
    )
    db.commit()


@app.teardown_appcontext
def close_connection(exception):
    db_list = getattr(g, "_db_list", [])
    for db_name in db_list:
        db = get_db(db_name)
        db.close()


app.run("0.0.0.0", port=8000 if app.config["DEBUG"] else 5000)
