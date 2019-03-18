# webgl_pbr

A physically based renderer in WebGL using three.js. Mainly a personal
playground.

## Running the samples

Install Node.js. Then inside the `/js` folder:

```
npm install -g http-server
npm install
```

Then navigate to the top level folder and run `http-server` without
arguments. Navigate to http://localhost:8080 in your browser.

Sample models can be downloaded at Sketchfab in glTF format, and extracted into
a `/models` folder (you have to create this directory yourself).

## Physically based rendering

This implements a Lambertian diffuse model along with a Cook-Torrance BRDF for
specular. The specular components used are GGX for the distribution term
combined with Schlick's approximation for the fresnel.

Heavily inspired by the work done by the folks at Epic Games on Unreal Engine 4.
