# Extracts every frame of the two source films into WebP sequences.
# Film 1 trims the top signboard and removes the corner mark; Film 2 keeps full height via delogo so faces are never clipped.
param(
  [string]$Ffmpeg = "C:\Users\Hp\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe",
  [string]$Src = "D:\Sumya\Saree website"
)

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "public\frames"

$v1Filter = "delogo=x=1844:y=1030:w=64:h=38,crop=iw*0.88:ih*0.88:iw*0.06:ih*0.085"
$v2Filter = "delogo=x=1844:y=1030:w=64:h=38"

$videos = @(
  @{ name = "v1"; file = "Saree_showroom_interior_tour_192d84db_1080p (1).mp4"; vf = $v1Filter },
  @{ name = "v2"; file = "Women_showcasing_silk_sarees_0e21f297_1080p (2).mp4"; vf = $v2Filter }
)
$sizes = @(
  @{ tag = "lg"; w = 1920; h = 1080; q = 78 },
  @{ tag = "sm"; w = 1280; h = 720;  q = 74 }
)

foreach ($v in $videos) {
  foreach ($s in $sizes) {
    $dir = Join-Path $out "$($v.name)-$($s.tag)"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Remove-Item "$dir\*.webp" -ErrorAction SilentlyContinue
    $vf = "$($v.vf),scale=$($s.w):$($s.h):flags=lanczos"
    & $Ffmpeg -hide_banner -loglevel error -y -i (Join-Path $Src $v.file) -vf $vf `
      -c:v libwebp -quality $s.q -compression_level 6 -preset photo `
      (Join-Path $dir "%04d.webp")
    $n = (Get-ChildItem "$dir\*.webp").Count
    Write-Output "$($v.name)-$($s.tag): $n frames"
  }
}

# Stills for the collection cards
$stills = Join-Path $root "public\images"
New-Item -ItemType Directory -Force -Path $stills | Out-Null
$v1 = Join-Path $Src $videos[0].file
$v2 = Join-Path $Src $videos[1].file
$list = @(
  @{ f = $v2; vf = $v2Filter; t = "0.4"; n = "kanjivaram-red" },
  @{ f = $v2; vf = $v2Filter; t = "2.2"; n = "pallu-detail" },
  @{ f = $v2; vf = $v2Filter; t = "4.0"; n = "mysore-blue" },
  @{ f = $v2; vf = $v2Filter; t = "7.4"; n = "banarasi-green" },
  @{ f = $v1; vf = $v1Filter; t = "0.3"; n = "store-entrance" },
  @{ f = $v1; vf = $v1Filter; t = "3.5"; n = "store-interior" },
  @{ f = $v1; vf = $v1Filter; t = "7.6"; n = "zari-closeup" }
)
foreach ($i in $list) {
  & $Ffmpeg -hide_banner -loglevel error -y -ss $i.t -i $i.f -frames:v 1 -vf "$($i.vf),scale=1600:-2:flags=lanczos" `
    -c:v libwebp -quality 82 (Join-Path $stills "$($i.n).webp")
}
Write-Output "stills done"
