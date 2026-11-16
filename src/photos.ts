export const maxPhotoLength = 200000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasm faylini o‘qib bo‘lmadi')); };
    image.src = url;
  });
}

export function isPhotoFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

export async function compressPhoto(file: File, size = 256): Promise<string> {
  if (!isPhotoFile(file)) throw new Error(`${file.name} — rasm fayli emas`);
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error(`${file.name} — bo‘sh rasm`);
  const scale = Math.min(1, size / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  const paint = (target: HTMLCanvasElement, w: number, h: number) => {
    target.width = w;
    target.height = h;
    const context = target.getContext('2d');
    if (!context) throw new Error('Rasmni qayta ishlash brauzerda mavjud emas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    context.drawImage(image, 0, 0, w, h);
    return context;
  };
  paint(canvas, width, height);
  let quality = 0.78;
  let data = canvas.toDataURL('image/jpeg', quality);
  while (data.length > maxPhotoLength && quality > 0.36) {
    quality = Math.round((quality - 0.1) * 100) / 100;
    data = canvas.toDataURL('image/jpeg', quality);
  }
  if (data.length > maxPhotoLength) {
    width = Math.max(1, Math.round(width * 0.7));
    height = Math.max(1, Math.round(height * 0.7));
    paint(canvas, width, height);
    data = canvas.toDataURL('image/jpeg', 0.6);
  }
  if (data.length > maxPhotoLength) throw new Error(`${file.name} — rasm juda katta, kichikroq fayl tanlang`);
  return data;
}
