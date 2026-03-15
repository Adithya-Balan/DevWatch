with open('extension.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r'    /\*\*[\s\S]*?kill all cleanup candidates[\s\S]*?\}\n\n', '', text, flags=re.IGNORECASE)
text = re.sub(r'     \* @param \{\{ candidates: object\[\] \}\} cleanupResult\n', '', text)

with open('extension.js', 'w') as f:
    f.write(text)
