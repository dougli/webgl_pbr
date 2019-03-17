uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tMetallicRoughness;
uniform sampler2D tEmissive;

uniform float roughness;
uniform float metallicness;
uniform float specular;
uniform vec3 emissive;

varying vec2 vUV;
varying mat3 vTBN;
varying vec3 vViewPosition;

out vec4 out_FragColor;

#ifndef gammaToLinear
vec4 gammaToLinear(in vec4 value) {
  return vec4(pow(value.rgb, vec3(2.2)), value.a);
}

vec4 linearToGamma(in vec4 value) {
  return vec4(pow(value.rgb, vec3(1.0 / 2.2)), value.a);
}
#endif

// The distribution function D models how many microfacets are facing a certain
// direction. For example, if 10% of the microfacets are facing in a given
// direction, this function should return 0.1.
//
// This is important since any microfacet facing the halfway vector should
// reflect light into the camera.
float distributionGGX(vec3 normal, vec3 halfway, float roughness) {
  // Based on Disney's GGX/Trowbridge-Reitz - same as Unreal 4
  // https://blog.selfshadow.com/publications/s2013-shading-course/karis/s2013_pbs_epic_notes_v2.pdf

  float NdotH = dot(normal, halfway);
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float denomFactor = (NdotH * NdotH * (alpha2 - 1.0) + 1.0);
  return alpha2 / (PI * denomFactor * denomFactor);
}

// The fresnel function F describes how light interacts with a material at
// grazing angles
//
// Default ior to 1.5 -- usually sufficient for most materials. Skin is 1.35
// https://docs.unrealengine.com/en-US/Engine/Rendering/Materials/PhysicallyBased
vec3 schlickFresnel(vec3 view, vec3 halfway, vec4 materialColor, float metalness) {
  float VdotH = dot(view, halfway);
  float approx = pow(abs(1.0 - max(VdotH, 0.0)), 5.0); // Schlick's approximation
  vec3 FoColor = mix(vec3(0.04), materialColor.rgb, metalness);
  return FoColor + (1.0 - FoColor) * approx;
}

// The geometry term G models the attenuation of microfacets self-shadowing each
// other, since even if deeper microfacets would reflect light to the camera,
// the path of light would be obstructed by more shallow microfacets.
//
// Based on Schlick approximation of Smith solved with GGX
float geometryGGXPartial(vec3 normal, vec3 l, float roughness) {
  // biased the roughness based on Disney's modification to reduce "hotness"
  float alphaBiased = roughness + 1.0;

  float k = alphaBiased * alphaBiased / 8.0;
  float NdotV = saturate(dot(normal, l));
  return NdotV / (NdotV * (1.0 - k) + k);
}

void main() {
  vec3 normal = normalize(vTBN * (texture2D(tNormal, vUV).rgb * 2.0 - 1.0));
  vec3 view = normalize(vViewPosition);
  float rough = texture2D(tMetallicRoughness, vUV).g * roughness;
  float metal = texture2D(tMetallicRoughness, vUV).b * metallicness;

  // All glTF textures are in sRGB
  vec4 diffuseColor = gammaToLinear(texture2D(tDiffuse, vUV));
  vec3 emissiveColor = emissive * gammaToLinear(texture2D(tEmissive, vUV)).rgb;

  vec3 totalDiffuseLight = (1.0 - metal) * ambientLightColor;
  vec3 totalSpecularLight = vec3(0);

  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 light = directionalLights[i].direction;
    vec3 halfway = normalize(view + light);

    float D = distributionGGX(normal, halfway, rough);
    vec3 F = schlickFresnel(light, halfway, diffuseColor, metal);
    float G = geometryGGXPartial(normal, light, rough) * geometryGGXPartial(normal, view, rough);

    vec3 kD = (vec3(1.0) - F) * (1.0 - metal);
    totalDiffuseLight += max(kD * dot(normal, light), 0.0) * directionalLights[i].color;
    totalSpecularLight += saturate(D * F * G) * directionalLights[i].color /
      saturate(4.0 * max(dot(normal, halfway), 0.0) * max(dot(normal, view), 0.0) + 0.0001);
  }
  #endif

  // Output in gamma color space
  out_FragColor = linearToGamma(
    vec4(diffuseColor.rgb * totalDiffuseLight + totalSpecularLight + emissiveColor, diffuseColor.a)
  );
}
