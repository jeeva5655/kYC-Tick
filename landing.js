// landing.js
const html = document.documentElement;
const canvas = document.getElementById("hero-lightpass");
const context = canvas.getContext("2d");
const loadingOverlay = document.getElementById("loading-overlay");
const heroContent = document.querySelector(".hero-content");

const frameCount = 240;
const currentFrame = index => (
  `/frames_4k/ezgif-frame-${index.toString().padStart(3, '0')}.jpg`
);

const images = [];
let loadedCount = 0;
let initialized = false;

// Crop width and height to hide the Gemini watermark (bottom right)
// We calculate this as a percentage (15%) inside the draw function now, 
// because upscaling to 4K would make a fixed 120px crop too small!

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
}

window.addEventListener('resize', () => {
    resizeCanvas();
    const scrollFraction = Math.max(0, Math.min(1, html.scrollTop / (html.scrollHeight - window.innerHeight)));
    drawFrame(scrollFraction || 0);
});

function drawFrame(scrollFraction) {
    const frameIndex = Math.min(
        frameCount - 1,
        Math.floor(scrollFraction * frameCount)
    );
    
    if (images[frameIndex] && images[frameIndex].complete && images[frameIndex].naturalWidth !== 0) {
        const img = images[frameIndex];
        
        // 15% crop to ensure the watermark is gone even at 4K resolution
        const cropRight = img.width * 0.15;
        const cropBottom = img.height * 0.15;
        
        const sourceWidth = img.width - cropRight;
        const sourceHeight = img.height - cropBottom;
        const targetRatio = canvas.width / canvas.height;
        const sourceRatio = sourceWidth / sourceHeight;
        
        let drawWidth, drawHeight, offsetX, offsetY;
        
        if (sourceRatio > targetRatio) {
            // source is wider than target, scale by height
            drawHeight = canvas.height;
            drawWidth = sourceWidth * (canvas.height / sourceHeight);
            offsetX = (canvas.width - drawWidth) / 2;
            offsetY = 0;
        } else {
            // source is taller, scale by width
            drawWidth = canvas.width;
            drawHeight = sourceHeight * (canvas.width / sourceWidth);
            offsetX = 0;
            offsetY = (canvas.height - drawHeight) / 2;
        }
        
        // Clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Use high quality smoothing
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        
        context.drawImage(
            img, 
            0, 0, sourceWidth, sourceHeight,
            offsetX, offsetY, drawWidth, drawHeight
        );
    }
}

// Preload all images
for (let i = 1; i <= frameCount; i++) {
  const img = new Image();
  img.src = currentFrame(i);
  img.onload = () => {
    loadedCount++;
    
    if (i === 1) {
      resizeCanvas();
      drawFrame(0);
    }
    
    if (loadedCount > 50 && !initialized) {
        initialized = true;
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);
    }
  };
  images.push(img);
}

// Ensure the loading overlay hides eventually even if not all first 50 frames load fast
setTimeout(() => {
    if (!initialized && loadedCount > 10) {
        initialized = true;
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);
    }
}, 3000);

const step1 = document.getElementById("step-1");
const step2 = document.getElementById("step-2");
const step3 = document.getElementById("step-3");

// Update canvas on scroll
window.addEventListener('scroll', () => {  
  const scrollTop = html.scrollTop;
  const maxScrollTop = html.scrollHeight - window.innerHeight;
  const scrollFraction = Math.max(0, Math.min(1, scrollTop / maxScrollTop));
  
  drawFrame(scrollFraction);
  
  // Scene 1 (Scroll 5% - 25%)
  if (scrollFraction > 0.05 && scrollFraction < 0.25) {
      step1.classList.add('visible');
  } else {
      step1.classList.remove('visible');
  }
  
  // Scene 2 (Scroll 30% - 50%)
  if (scrollFraction > 0.30 && scrollFraction < 0.50) {
      step2.classList.add('visible');
  } else {
      step2.classList.remove('visible');
  }
  
  // Scene 3 (Scroll 55% - 75%)
  if (scrollFraction > 0.55 && scrollFraction < 0.75) {
      step3.classList.add('visible');
  } else {
      step3.classList.remove('visible');
  }

  // Scene 4 (Scroll 85%+)
  if (scrollFraction > 0.85) {
      heroContent.classList.add('visible');
  } else {
      heroContent.classList.remove('visible');
  }
});
