/**
 * 图片加载优化：渐进式加载 + 格式自动选择 + 模糊占位符
 */

// 检测浏览器支持的最佳图片格式
let bestFormat = null;

export async function detectBestImageFormat() {
  if (bestFormat) return bestFormat;
  
  // 检测 AVIF 支持
  const avifSupported = await checkImageSupport(
    'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A='
  );
  
  if (avifSupported) {
    bestFormat = 'avif';
    return bestFormat;
  }
  
  // 检测 WebP 支持
  const webpSupported = await checkImageSupport(
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA='
  );
  
  if (webpSupported) {
    bestFormat = 'webp';
    return bestFormat;
  }
  
  bestFormat = 'jpg';
  return bestFormat;
}

function checkImageSupport(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width === 1);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

// 生成优化后的图片 URL（根据格式和尺寸）
export function getOptimizedImageUrl(originalUrl, options = {}) {
  if (!originalUrl || originalUrl.startsWith('data:')) return originalUrl;
  
  const { width, quality = 85, format } = options;
  const url = new URL(originalUrl, window.location.origin);
  
  // 如果后端支持图片处理，添加参数
  if (format && format !== 'jpg') {
    url.searchParams.set('format', format);
  }
  if (width) {
    url.searchParams.set('w', width);
  }
  if (quality !== 85) {
    url.searchParams.set('q', quality);
  }
  
  return url.toString();
}

// 模糊占位符生成（使用 Canvas 缩放）
export function generateBlurPlaceholder(img, blurAmount = 10) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // 缩小到 40px 宽度比例
  const smallWidth = 40;
  const aspectRatio = img.naturalHeight / img.naturalWidth;
  const smallHeight = Math.round(smallWidth * aspectRatio);
  
  canvas.width = smallWidth;
  canvas.height = smallHeight;
  
  // 绘制缩小版
  ctx.drawImage(img, 0, 0, smallWidth, smallHeight);
  
  // 应用模糊（CSS filter 会在实际使用时应用）
  return canvas.toDataURL('image/jpeg', 0.6);
}

// 渐进式图片加载组件辅助函数
export class ProgressiveImageLoader {
  constructor(src, options = {}) {
    this.src = src;
    this.options = options;
    this.img = null;
    this.loaded = false;
    this.error = false;
    this.callbacks = {
      onLoad: [],
      onError: [],
      onProgress: [],
    };
  }
  
  load() {
    if (this.img) return Promise.resolve(this.img);
    
    return new Promise((resolve, reject) => {
      this.img = new Image();
      
      // 支持 srcset 和 sizes
      if (this.options.srcset) {
        this.img.srcset = this.options.srcset;
      }
      if (this.options.sizes) {
        this.img.sizes = this.options.sizes;
      }
      
      // 懒加载
      if ('loading' in HTMLImageElement.prototype && this.options.lazy !== false) {
        this.img.loading = 'lazy';
      }
      
      // 解码优化
      if ('decoding' in this.img) {
        this.img.decoding = 'async';
      }
      
      this.img.onload = () => {
        this.loaded = true;
        this.callbacks.onLoad.forEach(cb => cb(this.img));
        resolve(this.img);
      };
      
      this.img.onerror = (err) => {
        this.error = true;
        this.callbacks.onError.forEach(cb => cb(err));
        reject(err);
      };
      
      this.img.src = this.src;
    });
  }
  
  onLoad(callback) {
    if (this.loaded) {
      callback(this.img);
    } else {
      this.callbacks.onLoad.push(callback);
    }
    return this;
  }
  
  onError(callback) {
    if (this.error) {
      callback(new Error('Image load failed'));
    } else {
      this.callbacks.onError.push(callback);
    }
    return this;
  }
  
  cancel() {
    if (this.img) {
      this.img.src = '';
      this.img = null;
    }
  }
}

// 预加载关键图片
export function preloadImages(urls) {
  return Promise.all(
    urls.map(url => {
      const loader = new ProgressiveImageLoader(url);
      return loader.load().catch(() => null); // 忽略失败
    })
  );
}

// 图片尺寸预测（用于 CLS 优化）
export function getImageDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// 初始化
let formatDetected = false;
export async function initImageOptimizer() {
  if (formatDetected) return;
  formatDetected = true;
  await detectBestImageFormat();
}
