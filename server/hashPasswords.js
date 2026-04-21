const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');
const adminsPath = path.join(__dirname, 'admins.json');

const hashFile = async (filePath) => {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let modified = false;
        for (let entry of data) {
            if (entry.password && !entry.password.startsWith('$2')) {
                entry.password = await bcrypt.hash(entry.password, 10);
                modified = true;
            }
        }
        if (modified) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`[SECURE] Passwords hashed for ${path.basename(filePath)}`);
        }
    } catch (e) { console.error('Error hashing', e); }
};

async function run() {
    await hashFile(usersPath);
    await hashFile(adminsPath);
}
run();
