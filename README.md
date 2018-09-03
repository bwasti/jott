# jott
A minimal tool for quickly writing and sharing notes.  Check out https://jott.live for a demo.

### Website

Navigate to the site and set a title in the 'name' field.  To set a key for editing the note, use
'name#key' in that field.

- `/note/<note-name>` will return the default HTML rendering of the note.
- `/raw/note/<note-name>` will return the note as raw text. (Useful with wget/curl.)
- `/texdown/note/<note-name>` will return a minimal [TeXDown](https://github.com/tex-ninja/texdown#texdown) rendering of the note. [Example](https://jott.live/texdown/note/test)
- `/code/note/<note-name>` will syntax highlight the note.
- `/edit/note/<note-name>` will open a basic editor for the note.


### Command line

The `note` script in `jott/scripts` makes it easy to upload and read notes from the command line.

To install the script without downloading the repo:
```
$ curl https://jott.live/raw/note/note_script > note.sh && chmod +x note.sh && alias note='./note.sh'
```

Upload a note by piping through `stdin`, `note [note name] [password]`
```
$ echo "this is a test" | note my_test_note secret_password
Success! Note "my_test_note" saved
```
Download a note with `note [note name]`
```
$ note my_test_note
this is a test
```
Delete a note with `note -d [note name] [password]`
```
$ note -d my_test_note secret_password
Success! Note "my_test_note" deleted
```

## Installation
Although you can use https://jott.live to test out this project, do not rely on it for anything important.

If you find this useful, I'd recommend hosting your own instance.  It is quite lightweight.

Requirements:
- flask (`pip install flask`)

Run the server with
```
FLASK_ENV=prod python3 main.py
```

