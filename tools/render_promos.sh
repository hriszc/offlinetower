#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FFMPEG="/Users/zhaochen/.local/bin/ffmpeg"
FONT="/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
RAW="$ROOT/output/promo/raw"
OUT="$ROOT/output/promo"

render_one() {
  local label="$1"
  local start="$2"
  local hook1="$3"
  local hook2="$4"
  local hook3="$5"
  local hook4="$6"
  local input
  input="$(jq -r .file "$RAW/scene-$label.json")"
  local output="$OUT/僵尸在敲门_0${label}_$(printf '%s' "$hook1" | tr -d ' ' | cut -c1-8).mp4"
  local graph

  graph="[0:v]split=2[bgsrc][fgsrc];
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=18:2,eq=brightness=-0.20:saturation=0.60[bg];
[fgsrc]scale=1080:608[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2-110,
eq=contrast=1.12:brightness=-0.04:saturation=0.80,
colorchannelmixer=rr=1.08:gg=0.90:bb=0.86,
vignette=PI/4.6,
noise=alls=7:allf=t+u,
drawbox=x=0:y=0:w=iw:h=ih:color=0x07070a@0.16:t=fill,
drawtext=fontfile=$FONT:text='僵尸在敲门':fontcolor=0xF7E9D2:fontsize=80:x=(w-text_w)/2:y=70:box=1:boxcolor=0x08090C@0.72:boxborderw=18,
drawtext=fontfile=$FONT:text='微恐塔防 · 每一局都像有人在门外':fontcolor=0xBBAFA1:fontsize=28:x=(w-text_w)/2:y=170:box=1:boxcolor=0x08090C@0.55:boxborderw=10,
drawtext=fontfile=$FONT:text='${hook1}':fontcolor=0xF3E5D0:fontsize=74:x=(w-text_w)/2:y=275:box=1:boxcolor=0x170508@0.82:boxborderw=16:enable='between(t,0,3.15)',
drawtext=fontfile=$FONT:text='${hook2}':fontcolor=0xF3E5D0:fontsize=74:x=(w-text_w)/2:y=275:box=1:boxcolor=0x170508@0.82:boxborderw=16:enable='between(t,3.15,7.15)',
drawtext=fontfile=$FONT:text='${hook3}':fontcolor=0xF3E5D0:fontsize=74:x=(w-text_w)/2:y=275:box=1:boxcolor=0x170508@0.82:boxborderw=16:enable='between(t,7.15,11.15)',
drawtext=fontfile=$FONT:text='${hook4}':fontcolor=0xF3E5D0:fontsize=74:x=(w-text_w)/2:y=275:box=1:boxcolor=0x170508@0.82:boxborderw=16:enable='between(t,11.15,15)',
drawbox=x=90:y=390:w=900:h=4:color=0xA51218@0.80:t=fill,
drawtext=fontfile=$FONT:text='别回头 · 先守住这一扇门':fontcolor=0xD8C8B7:fontsize=42:x=(w-text_w)/2:y=1575:box=1:boxcolor=0x08090C@0.70:boxborderw=14:enable='between(t,0,7.15)',
drawtext=fontfile=$FONT:text='裂隙不会等你准备好':fontcolor=0xD8C8B7:fontsize=42:x=(w-text_w)/2:y=1575:box=1:boxcolor=0x08090C@0.70:boxborderw=14:enable='between(t,7.15,15)',
drawtext=fontfile=$FONT:text='点击左下角 · 现在开一局':fontcolor=0xF4C66A:fontsize=58:x=(w-text_w)/2:y=1685:box=1:boxcolor=0x08090C@0.82:boxborderw=18,
drawtext=fontfile=$FONT:text='《僵尸在敲门》':fontcolor=0xF7E9D2:fontsize=64:x=(w-text_w)/2:y=1785:box=1:boxcolor=0x170508@0.88:boxborderw=18,
drawbox=x=0:y=0:w=iw:h=ih:color=0x9B0E12@0.34:t=fill:enable='between(t,0,0.16)',
drawbox=x=0:y=0:w=iw:h=ih:color=0x9B0E12@0.34:t=fill:enable='between(t,3.15,3.30)',
drawbox=x=0:y=0:w=iw:h=ih:color=0x9B0E12@0.34:t=fill:enable='between(t,7.15,7.30)',
drawbox=x=0:y=0:w=iw:h=ih:color=0x9B0E12@0.34:t=fill:enable='between(t,11.15,11.30)',
scale=1088:1936,
crop=1080:1920:x='4+3*sin(t*9)':y='8+3*cos(t*7)'[v];
[1:a]lowpass=f=240,volume=3.5,alimiter=level_in=1:level_out=1:limit=0.9[a]"

  "$FFMPEG" -y -hide_banner -loglevel error \
    -ss "$start" -t 15 -i "$input" \
    -f lavfi -t 15 -i "aevalsrc=exprs=0.10*sin(2*PI*43*t)*(0.45+0.55*sin(2*PI*1.2*t))+0.03*sin(2*PI*65*t)+0.015*random(0):s=48000:d=15" \
    -filter_complex "$graph" \
    -map "[v]" -map "[a]" \
    -t 15 -r 30 -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
    -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart "$output"

  printf '%s\n' "$output"
}

render_one a 86 "别回头看身后" "先修墙，再听门" "它们已经靠近了" "守住天亮"
render_one b 40 "裂隙开了" "它们不走正门" "狂潮正在逼近" "《僵尸在敲门》"
render_one c 35 "家只剩 1 点血" "每一秒都在敲门" "别让最后一盏灯熄灭" "《僵尸在敲门》"
