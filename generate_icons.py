#!/usr/bin/env python3
"""Generate PNG icons from SVG"""

import subprocess
import os

SVG_FILE = "ic copy.svg"
ICONS_DIR = "icons"
SIZES = [16, 48, 128]

def main():
    os.makedirs(ICONS_DIR, exist_ok=True)
    
    for size in SIZES:
        output = os.path.join(ICONS_DIR, f"icon{size}.png")
        
        # 尝试使用 rsvg-convert (librsvg)
        try:
            subprocess.run([
                "rsvg-convert",
                "-w", str(size),
                "-h", str(size),
                SVG_FILE,
                "-o", output
            ], check=True)
            print(f"✓ Generated {output}")
            continue
        except FileNotFoundError:
            pass
        
        # 尝试使用 ImageMagick convert
        try:
            subprocess.run([
                "convert",
                "-background", "none",
                "-resize", f"{size}x{size}",
                SVG_FILE,
                output
            ], check=True)
            print(f"✓ Generated {output}")
            continue
        except FileNotFoundError:
            pass
        
        # 尝试使用 sips (macOS)
        try:
            # sips 不直接支持 SVG，需要先用 qlmanage 预览
            subprocess.run([
                "qlmanage", "-t", "-s", str(size), "-o", ICONS_DIR, SVG_FILE
            ], check=True, capture_output=True)
            # 重命名生成的文件
            generated = os.path.join(ICONS_DIR, f"{SVG_FILE}.png")
            if os.path.exists(generated):
                os.rename(generated, output)
                print(f"✓ Generated {output}")
                continue
        except:
            pass
        
        print(f"✗ Failed to generate {output}")
        print("  Please install rsvg-convert: brew install librsvg")
        print("  Or use an online converter: https://cloudconvert.com/svg-to-png")

if __name__ == "__main__":
    main()
