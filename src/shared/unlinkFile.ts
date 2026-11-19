import fs from 'fs';
import path from 'path';

const unlinkFile = (file: string | undefined | null) => {
    if (!file || typeof file !== 'string') return;

    // Normalize base upload directory
    const baseUploadDir = path.resolve(process.cwd(), 'uploads');

    // Clean leading slashes and path traversal tokens
    const cleanedFile = file.trim().replace(/^(\.\.[\/\\])+/, '').replace(/^\/+/, '');
    const targetPath = path.resolve(baseUploadDir, cleanedFile);

    // Path Traversal Prevention: Ensure target is strictly inside uploads directory
    if (!targetPath.startsWith(baseUploadDir)) {
        return;
    }

    if (fs.existsSync(targetPath)) {
        try {
            fs.unlinkSync(targetPath);
        } catch {
            // Silently ignore deletion error if file is locked or missing
        }
    }
};

export default unlinkFile;
