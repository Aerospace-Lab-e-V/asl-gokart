#!/bin/bash

GITHUB_API_BASE_URL="https://api.github.com"
GITHUB_PAT="<your_github_personal_access_token"
org="Aerospace-Lab-e-V"
repo="asl-gokart"
release_file="tmp/release-selected.json"
response_all_releases="tmp/releases-all.json"

# Ensure the tmp directory exists
mkdir -p tmp

# Ensure the GITHUB_API_BASE_URL and the GITHUB_PAT are valid
if [[ -z "$GITHUB_PAT" ]]; then
    echo "Error: GITHUB_PAT is not set. Please set it to a valid GitHub Personal Access Token with repo access."
    exit 1
fi

# Check internet connectivity by pinging GitHub API
if ! ping -c 1 api.github.com &> /dev/null; then
    echo "Error: No internet connectivity. Please check your network connection and try again."
    exit 1
fi

# Check if the GITHUB_PAT is valid by making a simple API request
response=$(curl -sH "Authorization: Bearer ${GITHUB_PAT}" "${GITHUB_API_BASE_URL}/user")
if [[ -z "$(echo "$response" | jq -r '.login // empty')" ]]; then
    echo "Error: Invalid GITHUB_PAT. Please check your token and try again."
    exit 1
fi

# ── Step 1: select a release ──────────────────────────────────────────────────

echo "Which version should be downloaded? 1) latest or 2) other"
read -p "Enter 1 or 2: " version_choice

if [[ $version_choice == "1" ]]; then
    echo "Fetching the latest release..."
    curl -sH "Authorization: Bearer ${GITHUB_PAT}" \
        "${GITHUB_API_BASE_URL}/repos/${org}/${repo}/releases/latest" > "${release_file}"

    version_name=$(jq -r '.tag_name // empty' "${release_file}")
    if [[ -z "$version_name" ]]; then
        echo "No release found."
        exit 1
    fi

    echo "Latest version: $version_name"

elif [[ $version_choice == "2" ]]; then
    echo "Fetching all available releases..."
    curl -sH "Authorization: Bearer ${GITHUB_PAT}" \
        "${GITHUB_API_BASE_URL}/repos/${org}/${repo}/releases" > "${response_all_releases}"

    release_count=$(jq '. | length' "${response_all_releases}")
    if [[ $release_count -eq 0 ]]; then
        echo "No releases found."
        exit 1
    fi

    echo "Available releases:"
    for i in $(seq 0 $(($release_count - 1))); do
        echo "$(($i + 1))) $(jq -r ".[$i].tag_name" "${response_all_releases}")"
    done

    read -p "Select release number: " selected_release_number
    if [[ $selected_release_number -lt 1 || $selected_release_number -gt $release_count ]]; then
        echo "Invalid input. Please run the script again and select a valid release number."
        exit 1
    fi

    selected_release_index=$(($selected_release_number - 1))
    version_name=$(jq -r ".[$selected_release_index].tag_name" "${response_all_releases}")
    jq ".[$selected_release_index]" "${response_all_releases}" > "${release_file}"

    echo "Selected version: $version_name"

else
    echo "Invalid input. Please run the script again and select either 1 or 2."
    exit 1
fi

# ── Step 2: select an asset ───────────────────────────────────────────────────

asset_count=$(jq '.assets | length' "${release_file}")
if [[ $asset_count -eq 0 ]]; then
    echo "No assets found in release $version_name."
    exit 1
fi

echo ""
echo "Available assets for $version_name:"
for i in $(seq 0 $(($asset_count - 1))); do
    echo "$(($i + 1))) $(jq -r ".assets[$i].name" "${release_file}")"
done

read -p "Select asset number (1-$asset_count): " selected_asset_number
if [[ $selected_asset_number -lt 1 || $selected_asset_number -gt $asset_count ]]; then
    echo "Invalid input. Please run the script again and select a valid asset number."
    exit 1
fi

selected_asset_index=$(($selected_asset_number - 1))
asset_id=$(jq -r ".assets[$selected_asset_index].id" "${release_file}")
asset_name=$(jq -r ".assets[$selected_asset_index].name" "${release_file}")

# ── Step 3: download or install ───────────────────────────────────────────────

echo ""
echo "Do you want to 1) just download or 2) download and install [$asset_name]?"
read -p "Enter 1 or 2: " download_or_install

if [[ $download_or_install == "1" ]]; then
    echo "Downloading $asset_name..."
    curl -L -H "Accept: application/octet-stream" \
        -H "Authorization: Bearer ${GITHUB_PAT}" \
        "${GITHUB_API_BASE_URL}/repos/${org}/${repo}/releases/assets/${asset_id}" \
        -o "${asset_name}"
    echo "Download complete: ${asset_name}"

elif [[ $download_or_install == "2" ]]; then
    if [[ "$asset_name" != *.deb ]]; then
        echo "Warning: selected asset is not a .deb package — dpkg installation will likely fail."
        read -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "Aborted."
            exit 1
        fi
    fi

    echo "Downloading $asset_name..."
    curl -L -H "Accept: application/octet-stream" \
        -H "Authorization: Bearer ${GITHUB_PAT}" \
        "${GITHUB_API_BASE_URL}/repos/${org}/${repo}/releases/assets/${asset_id}" \
        -o "tmp/${asset_name}.downloaded"
    echo "Download complete: tmp/${asset_name}.downloaded"

    sudo dpkg -i "tmp/${asset_name}.downloaded"
    echo "Installation complete!"

else
    echo "Invalid input. Please run the script again and select either 1 or 2."
    exit 1
fi
