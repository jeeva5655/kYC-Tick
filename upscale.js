import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const inputDir = path.join(process.cwd(), 'frames');
const outputDir = path.join(process.cwd(), 'frames_4k');

async function main() {
    console.log("Creating output directory...");
    await fs.mkdir(outputDir, { recursive: true });
    
    console.log("Reading input frames...");
    const files = await fs.readdir(inputDir);
    const imageFiles = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
    
    console.log(`Found ${imageFiles.length} images. Starting 4K Lanczos upscaling...`);
    let count = 0;
    
    for (const file of imageFiles) {
        const inputPath = path.join(inputDir, file);
        const outputPath = path.join(outputDir, file);
        
        await sharp(inputPath)
            .resize({
                width: 3840, // 4K resolution width
                kernel: sharp.kernel.lanczos3 // High quality upscaling algorithm
            })
            .jpeg({ quality: 90 }) // Save as high-quality JPEG
            .toFile(outputPath);
            
        count++;
        if (count % 20 === 0) {
            console.log(`Processed ${count}/${imageFiles.length} frames...`);
        }
    }
    
    console.log("Upscaling complete! The 4K frames are saved in 'frames_4k'.");
}

main().catch(console.error);
